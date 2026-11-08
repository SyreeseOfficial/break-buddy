# Break Buddy: Build Plan (for Claude Code)

Source of truth for *what*: `PRD.md`. This file is *how*. Read both before coding.
If they conflict, PRD wins, then flag it to Syreese.

## 0. Rules for the coding agent

- Build one phase at a time (section 6). Stop after each phase. Show how to verify it on the Deck.
- Smallest diff that works. No abstractions the PRD doesn't need. No new deps unless asked.
- User knows Android, new to React/TS: short comments on non-obvious React bits (hooks, effects).
- Ask before big structural changes.
- Never use `decky-frontend-lib` or `serverAPI` (dead). Only `@decky/ui` + `@decky/api`.
- Do not run the plugin or Docker builds yourself. Syreese deploys and tests on the Deck.

## 1. Research results (PRD section 7)

Checked against `decky-plugin-template`, `decky-playground`, `decky-autosuspend` (cloned and read).

| # | Question | Answer | Confidence |
|---|---|---|---|
| 1 | Toast API | `toaster.toast({title, body, duration, sound, icon, critical, ...})` from `@decky/api`. Template already uses it. `ToastData` type is exported from `@decky/api`. | High |
| 2 | Suspend event | `SteamClient.System.RegisterForOnResumeFromSuspend(cb)` (autosuspend `SteamUtils.ts`). **Not needed**: backend detects suspend itself (section 3). Skip the event. | High |
| 3 | Sound over a game | autosuspend passes `sound: NavSoundMap[name]`, where `NavSoundMap = findModuleChild(...)` looks for a module with property `"ToastMisc"`. Works as a toast field. Over-game behavior: **test on Deck** (Phase 8). | Medium |
| 4 | Toast duration | `duration` field (ms) on toast data. autosuspend passes it. Set `5000`. | High |
| 5 | One-shot input | Not found in playground. Playground has Slider, Toggle, Dropdown, TextField only. **Pick: reuse the same 5-120 min slider** as repeats ("in N minutes"). Zero new UI. | Decision |
| 6 | Existing plugin / name collision | **Not verified** (store API call was blocked). Syreese: search plugins.deckbrew.xyz for "break", "remind", "hydrate". | Open |
| 7 | Store requirements | Later. Skip. | n/a |

Playground files worth opening when building UI: `src/playgrounds/SliderPlayground.tsx`, `TogglePlayground.tsx`, `TextFieldPlayground.tsx`.

## 2. Template facts (from `decky-plugin-template`)

- Backend: `main.py`, class `Plugin`. Hooks: `_migration`, `_main`, `_unload`, `_uninstall`. Public async methods are callable from the frontend by name.
- `decky.emit(event_name, *args)` pushes to the frontend. Frontend: `addEventListener(name, cb)` / `removeEventListener(name, cb)`.
- Frontend: `callable<[args], ret>("python_method_name")`.
- Paths: `decky.DECKY_PLUGIN_SETTINGS_DIR` (store `settings.json` here), `decky.DECKY_PLUGIN_RUNTIME_DIR`, `decky.logger`.
- `plugin.json` has `flags: ["debug", "_root"]`. **Remove `_root`.** We don't need root.
- Build: `pnpm install`, `pnpm build` (rollup). Zip layout per template README.
- Template ships `react-icons`. Use it for the plugin icon (e.g. `FaRegBell`).

## 3. Architecture (decisions)

**Backend owns the clock.** Frontend renders and toasts only (PRD D7).

### Time source (this solves D1/D2 cheaply)

Linux `time.monotonic()` (CLOCK_MONOTONIC) **does not advance during suspend**. Use it for repeats and the pause-on-suspend rule comes free. No burst on resume.

- **Repeat reminders:** deadline = `time.monotonic() + interval`. Pauses across suspend automatically.
- **One-shots:** `fire_at` = epoch (`time.time()`). Persisted. Overdue on resume or startup: fire once.
- **Tick loop:** one asyncio task, 1 s sleep. Each tick: fire everything due, then compare `wall_delta - mono_delta`. If > 5 s, a suspend just happened: shift every repeat's `next_fire` epoch forward by that gap and emit `state_changed`.
- Frontend countdown reads `next_fire` (epoch, display only): `next_fire - Date.now()/1000`. Backend keeps an internal monotonic deadline per reminder and derives `next_fire` epoch from it whenever state is sent.

Keep it simple: store `remaining` logic in one `Timer` dict `{id: mono_deadline}`, separate from persisted `Reminder` data.

### Persistence

- `settings.json` in `DECKY_PLUGIN_SETTINGS_DIR`. Atomic write (write temp file, `os.replace`).
- Persist: `schema_version`, `master_enabled`, `reminders[]`. Do **not** persist repeat deadlines (D6: restart from full interval on boot).
- Persist one-shot `fire_at`. On `_main`: overdue one-shots go to the fire queue.
- `_migration`: no old data to migrate. Just check `schema_version`; no-op for v1.

### Backend to frontend delivery

Decision (PRD left open, section 6/10): **queue on backend, drain on frontend load.**

- Backend appends fired reminders to `self.pending` (list of `{id, title}`) and calls `decky.emit("reminder_fired", id, title)`.
- Frontend on plugin load calls `drain_pending()` and toasts whatever comes back. This covers "Steam UI reloaded" and "Deck just booted, one-shot was overdue".
- To avoid double toasts: backend clears `pending` item when `emit` is sent **only if** the frontend has called `frontend_ready()` at least once since last reload. Simplest version: frontend calls `frontend_ready()` on mount, which returns and clears pending and sets `self.listening = True`. `_unload`/`onDismount` calls `frontend_gone()` to reset. If not listening, fired reminders just append to `pending`. Cap `pending` at 10, drop oldest.
- Drop stale items older than 10 min when draining (a "drink water" toast from an hour ago is noise).

### Toast queue (Phase 7)

Frontend only. Module-level array + a single async loop: show toast, wait `duration + 1500 ms`, next. No backend involvement.

### Settings of toasts

`{title: reminder.message, duration: 5000}`. No `body`. Sound added in Phase 8 only if it works.

## 4. Data model

Matches PRD section 5. Python dicts, JSON on disk. TS interface mirrors it.

```
Reminder:
  id: str              # builtin: "eye" | "water" | "posture" | "wrist"; custom: uuid4 hex
  label: str           # QAM row name
  message: str         # toast title
  type: "builtin" | "custom"
  mode: "repeat" | "once"
  interval_seconds: int   # repeat only
  fire_at: float | None   # once only, epoch
  enabled: bool
  # runtime only (not persisted): next_fire (epoch, derived), last_fired

State (sent to frontend): { master_enabled, reminders: [Reminder + next_fire] }
```

Built-in defaults (exact):

| id | label | message | interval | enabled |
|---|---|---|---|---|
| eye | Eye break | Eye break: look 20 ft away for 20 sec | 1200 | true |
| water | Hydration | Drink some water | 1800 | false |
| posture | Posture check | Posture check: sit up, relax shoulders | 1200 | false |
| wrist | Hand/wrist stretch | Stretch your hands and wrists | 2700 | false |

`sound_enabled` is **omitted** until Phase 8 proves sound works.

## 5. Bridge contract

Backend methods (`callable` names must match exactly):

| Method | Args | Returns | Notes |
|---|---|---|---|
| `get_state` | none | State | Frontend calls on QAM open |
| `set_master` | `enabled: bool` | State | On = restart all timers |
| `update_reminder` | `id, patch: dict` | State | Patch keys: `enabled, interval_seconds, label, message, mode, fire_at`. Any change to `enabled` or `interval_seconds` restarts that countdown (D8/D9). Reject unknown keys. Clamp interval to 300..7200 and snap to 300 steps. |
| `add_custom` | `label, mode, minutes` | State | `once`: `fire_at = now + minutes*60`. `repeat`: interval = minutes*60. Message = label. |
| `delete_reminder` | `id` | State | Custom only. Reject builtins. |
| `test_toast` | none | None | Emits one `reminder_fired` with title "Break Buddy test" |
| `reset_defaults` | none | State | Restores builtins, keeps custom |
| `frontend_ready` | none | `[{id,title,ts}]` | Drains pending, sets listening |
| `frontend_gone` | none | None | Clears listening |

Events (Python to frontend): `reminder_fired(id, title)` and `state_changed()` (frontend re-calls `get_state`).

Validation lives in the backend at these boundaries only. Frontend trusts backend state.

## 6. Phases

Each phase = one working, testable chunk. Syreese tests on the Deck, then says "next".

### Phase 1: Scaffold ✅ DONE
- Copy template files into repo root (keep template `LICENSE` at bottom of ours; Syreese's license goes on top, PRD section 11).
- `plugin.json`: name "Break Buddy", author, drop `_root` flag, real description.
- `package.json`: name `break-buddy`, author, description.
- Strip template example UI. Hello-world panel titled "Break Buddy".
- **Check:** `pnpm install && pnpm build` succeeds. Loads on Deck.
- Also commit `.gitignore` (node_modules, dist, out).

### Phase 2: One timer, one toast ✅ DONE
- Backend: 1 s tick loop in `_main` (task stored on `self`, cancelled in `_unload`). One hardcoded 20-min repeat, plus env override or a debug value of 15 s while developing (remove or leave as constant `DEV_INTERVAL`).
- Frontend: listen `reminder_fired`, call `toaster.toast`. QAM: one toggle.
- **Check:** toast fires; toggle off stops it; reload plugin leaves one loop only (log timer start/stop).

### Phase 3: Reminder model + persistence + master toggle ✅ DONE
- Backend: `Reminder` dicts, load/save `settings.json`, 4 built-ins, `get_state`/`set_master`/`update_reminder`.
- Frontend: master `ToggleField`; per built-in: `ToggleField`, `SliderField` (5-120, step 5, minutes), "next in mm:ss" (client `setInterval` 1 s, display only).
- Collapsible rows: grep `@decky/ui` exports for a collapsible component and use it if found. Else fallback: one `ToggleField` row plus slider and countdown shown only when enabled (decision 4, section 9).
- **Check:** settings survive Steam restart. Interval change restarts countdown. Toggle off/on restarts.

### Phase 4: Suspend + restart behavior ✅ DONE
- Add wall-vs-monotonic gap detection (section 3). Emit `state_changed` after a suspend.
- One-shot overdue-on-resume and overdue-on-startup logic.
- Add `frontend_ready` / `pending` drain (section 3).
- **Check (PRD section 9):** suspend 10 min mid-countdown, no burst, countdown resumes. Reboot: repeats restart full interval.

### Phase 5: Custom reminders
- Backend: `add_custom`, `delete_reminder`, one-shot removal after firing (delete from list, save).
- Frontend: custom list under built-ins, each: toggle, edit, delete (delete shows `ConfirmModal`). "Add reminder" opens a `ModalRoot` form: `TextField` (label, Steam keyboard opens by default), `DropdownItem` or two buttons for once vs repeat, minutes `SliderField`.
- Edit uses the same form, prefilled.
- **Check:** one-shot across Steam restart and reboot fires once.

### Phase 6: Toast queue, test toast, reset
- Frontend sequential toast loop. "Send test toast" button. "Reset to defaults" with `showModal(<ConfirmModal .../>)`.
- **Check:** two reminders due together show one after another.

### Phase 7: Sound (timeboxed, 1 hour)
- Port autosuspend's `findModuleChild` lookup for `"ToastMisc"`. Pass `sound: NavSoundMap.<name>` in the toast call. Try one fixed sound; no picker.
- If it doesn't play over a running game: delete the code, do not add toggles. Note outcome in `PRD.md` section 3.1.

### Phase 8: Hardware pass + dogfood
- Run PRD section 9 checklist top to bottom. Log results in `TESTING.md` (pass/fail, notes).

## 7. File layout

```
break-buddy/
  PRD.md
  BUILD_PLAN.md
  plugin.json
  package.json
  main.py                  # Plugin class: tick loop, settings, bridge methods
  src/
    index.tsx              # definePlugin, event listeners, icon
    api.ts                 # all callable<> declarations + State/Reminder types
    toastQueue.ts          # Phase 6 sequential toasts
    components/
      Panel.tsx            # QAM layout
      ReminderRow.tsx
      CustomForm.tsx       # modal for add/edit
  LICENSE
```

Keep `main.py` as one file. Split only if it passes ~300 lines.

## 8. Pitfalls to avoid

- `_unload` must cancel the tick task. Orphan loops = duplicate toasts.
- Never `await` slow work inside the tick loop. Save settings after the tick's fire pass.
- Frontend `useEffect` that adds a listener must remove it on cleanup.
- `time.time()` can jump (NTP, resume). Only use it for one-shots and display. All repeat math uses `monotonic`.
- Don't send per-second events. Frontend computes countdowns.
- After any backend mutation, return the full State so the UI never drifts.
- Ports 1337/8080 are Decky's. CEF debugging: `http://<deck-ip>:8081`.

## 9. Decisions (answered by Syreese)

1. **Resume:** countdown resumes with time left (easy with monotonic, see section 3). Fallback if it proves hard: just pause on suspend.
2. **Name check:** skipped, not blocking. Revisit before store submission.
3. **Custom delete:** needs a confirm dialog (`ConfirmModal`).
4. **Collapsible rows:** use real expand/collapse if `@decky/ui` has a component for it (grep its exports in Phase 3). If not, use the best-looking option Decky supports; default fallback is controls shown only when the reminder is enabled.
5. **Late toasts:** deliver on reconnect if under 10 min old. Approved.
