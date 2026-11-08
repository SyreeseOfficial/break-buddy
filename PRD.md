# Break Buddy: Decky Loader Wellness Reminders

**Status:** PRD finalized after interview, no code yet. **Owner:** Syreese. **Scope:** ~weekend to 2 weeks for v1.
**v1 finish line:** Works on my own Deck. Store submission and branding come later.
**v1 success bar:** All timers behave correctly across suspend, reboot, and Steam client restart.

## 1. Goal

A Decky Loader plugin for Steam Deck (Gaming Mode) that nudges the player to look after themselves while gaming. Reminder-based only. No sensors. Fire-and-forget: the toast appears, the player acts (or doesn't). Nothing to tap.

**UX principle:** clean, easy, and native-feeling inside Decky/QAM. When a feature is hard or fiddly with a controller, cut it.

## 2. Non-goals (v1)

- No posture/IMU/sensor detection
- No forced game pausing or locking
- No rumble/haptics (fragile across SteamOS updates)
- No snooze or dismiss controls (toast is fire-and-forget; disabling is done via QAM toggles)
- No persistent on-screen indicator / overdue badge
- No custom audio files or custom sound playback
- No quiet hours / DND schedule
- No per-game settings (global only)
- No stats, streaks, or stretch guide
- No custom branding/icon (template default until later)

## 3. Features

### 3.1 Built-in reminders (repeating, each independently configurable)

| Reminder | Default interval | Default state |
|---|---|---|
| Eye break (20-20-20) | 20 min | **On** |
| Hydration | 30 min | Off |
| Posture check | 20 min | Off |
| Hand/wrist stretch | 45 min | Off |

Per reminder: on/off, interval (slider, 5 to 120 min, 5-min steps). Message text is title only (e.g. "Drink some water", "Eye break: look 20 ft away for 20 sec") and is not user-editable for built-ins in v1.

Sound outcome: tried in Phase 7, no sound played on the Deck; removed (no sound toggle). Original plan: use the toast API's built-in sound parameter if it works for free. If it is fiddly, drop sound entirely (remove sound toggle and notification-style setting).

### 3.2 Custom reminders (full custom in v1)

- User-created with a free-text label (Steam on-screen keyboard), e.g. "Walk the dog"
- **One-shot:** "in N minutes" only. Use whichever input is the cleanest and most common in Decky plugins (stepper / slider / +5 +15 +30 buttons; pick during research, step 1). No time-of-day picker in v1.
- **Repeating:** every N minutes (same 5 to 120 min slider as built-ins)
- Edit, delete, enable/disable
- Shares the same engine and data model as built-ins. Built-ins are just preset entries.
- One-shot reminders are removed (or marked done) after firing.

### 3.3 QAM panel UI

Layout, top to bottom:

1. **Global master on/off**
2. **Built-in reminders:** collapsible rows. Each row: toggle, interval slider, "next in mm:ss"
3. **Custom reminders:** list below built-ins, each with toggle, edit, delete. "Add reminder" button at the bottom opens the form (label, one-shot vs repeat, time/interval)
4. **Utilities:** "Send test toast" (one global button), "Reset to defaults" (confirm dialog; restores built-ins, keeps custom reminders)

No tabs (clunky with controller navigation in QAM).

### 3.4 Notification behavior

- Toast shows title only, platform-default duration. Target 5 sec if the API makes it easy to change, otherwise accept default.
- **Collisions:** if multiple reminders come due at nearly the same time, queue them and show one toast at a time with a short gap.
- Sound: see 3.1.

### 3.5 Later (not v1)

Stats (breaks taken vs skipped, streaks, hydration count), stretch-of-the-day guide, quiet hours / DND, snooze, per-game disable list, persistent indicator, custom sounds, "at 9:00 PM" one-shots, editable built-in messages, custom icon/branding.

## 4. Behavior rules (decisions resolved)

| # | Decision | Resolution |
|---|---|---|
| D1 | Suspend / no game running | Repeating timers **count while awake**. Pause on suspend, keep running in the Steam menu (no game-state tracking needed). One-shots use wall-clock. |
| D2 | Missed on resume | One-shots fire once on resume if overdue. Missed repeats are skipped; the interval restarts. |
| D3 | Toast action buttons | Not needed. Snooze/dismiss cut from v1. |
| D4 | Quiet hours | Deferred. |
| D5 | One-shots across reboot / Steam restart | Persisted by epoch time. If overdue at startup, fire once. |
| D6 | Repeating timers across reboot / Steam restart | Interval restarts from startup. |
| D7 | Who owns the clock | Python backend owns all timers. Frontend only renders QAM and toasts. Survives Steam UI reloads. |
| D8 | Changing an interval mid-countdown | Restart that reminder's countdown with the new interval. |
| D9 | Disabling then re-enabling | Countdown restarts from full interval. |

**Suspend detection:** prefer a Steam suspend/resume event if available. Fallback: backend loop detects a wall-clock jump larger than the tick size and treats it as a suspend (then applies D2).

## 5. Data model

```
Reminder {
  id, label, message,
  type: "builtin" | "custom",
  mode: "repeat" | "once",
  interval_seconds   // repeat
  fire_at            // once, epoch
  enabled,
  sound_enabled      // only if sound survives research
  last_fired, next_fire
}

Settings {
  master_enabled,
  reminders: Reminder[],
  schema_version
}
```

`snooze_until` removed (no snooze in v1). Persisted in plugin settings. `_main` rebuilds timers from saved settings on startup. `schema_version` supports `_migration` later.

## 6. Architecture

- **Frontend:** React/TypeScript, `@decky/ui` + `@decky/api`. Renders QAM, shows toasts, plays sound if kept.
- **Backend:** Python `Plugin` class in `main.py` (`_migration`, `_main`, `_unload`, `_uninstall`). asyncio timers + settings storage. Owns the clock.
- **Bridge:** `callable()` (frontend → Python) for CRUD/test/reset; `addEventListener()` (Python → frontend) for "reminder fired" events. QAM "next in mm:ss" is computed on the frontend from `next_fire` (no per-second backend traffic).
- Backend emits events only while the frontend is listening; if the frontend isn't loaded when a reminder fires, queue and deliver on reconnect (or drop; decide in step 4 of build order).
- Use the template's settings/runtime/log helpers (`decky.migrate_settings`, `migrate_runtime`, `DECKY_USER_HOME`).
- Do NOT use `decky-frontend-lib` / `serverAPI` (outdated).

## 7. Verify before building

1. Exact `@decky/ui` toast API: title, body, icon, duration, sound
2. Steam suspend/resume event (likely `SteamClient`; check decky-playground). Game start/stop events no longer required for v1.
3. Whether toast built-in sound works over a running game. If not trivial, drop sound.
4. Whether toast duration is easily changeable (target 5 sec)
5. Which one-shot input pattern is cleanest/most common in existing Decky plugins
6. Whether a similar plugin already exists in the store (plugins.deckbrew.xyz) and name collisions for "Break Buddy"
7. Current store submission requirements (only relevant later)

## 8. Build order

1. Read decky-playground + decky-autosuspend, resolve section 7
2. Scaffold from decky-plugin-template, hello-world loads on Deck
3. One repeating backend timer → toast, with QAM toggle
4. Generalize to shared Reminder model, add 4 built-ins + saved settings + master toggle
5. Suspend/resume handling (D1/D2) and restart behavior (D5/D6)
6. Custom reminders (one-shot + repeat), add/edit/delete UI
7. Toast queueing, test toast button, reset to defaults
8. Sound (timeboxed; drop if hard)
9. Real-hardware testing: suspend/resume, reboot, Steam client restart, overlapping timers. Then dogfood a week.

## 9. Test checklist (v1 acceptance)

- Eye break fires at ~20 min on a fresh install with defaults
- Interval change restarts countdown; toggle off/on restarts countdown
- Suspend 10 min mid-countdown: no burst of toasts on resume, countdown resumes (D1/D2)
- One-shot set for 10 min, Deck suspended past due: fires once on resume
- One-shot pending across reboot and across Steam restart: fires at/after due time
- Repeating timers after reboot: restart from full interval
- Two reminders due together: toasts queue, one at a time
- Master off: nothing fires. Master on: timers restart
- Reset to defaults: built-ins restored, custom kept
- Plugin unload/reload leaves no orphan timers

## 10. Risks

| Risk | Mitigation |
|---|---|
| Decky breaks after Steam UI updates | Accept; shared by all plugins |
| Toasts easy to miss mid-game | Accept for v1; revisit indicator only if dogfooding shows it matters |
| Toast sound/duration limited by API | Timebox; cut sound, accept default duration |
| Suspend detection unreliable | Wall-clock jump fallback |
| Frontend not loaded when reminder fires | Decide queue vs drop in build step 4 |
| Docker needed for Python backend builds | Keep backend simple |

## 11. Setup notes

- Node.js + pnpm (version per template README; `pnpm update @decky/ui --latest` if build complains)
- Docker for backend builds
- Debug: enable "Allow Remote CEF Debugging" in Decky, open `http://<deck-ip>:8081`
- Ports 1337/8080 are used by Decky; watch for conflicts (e.g. Syncthing)
- License: plugin license at top of LICENSE, template license kept at bottom

## 12. References

- decky-loader, decky-plugin-template, decky-playground (best API reference), decky-frontend-lib (`@decky/ui`), decky-plugin-database: all under `github.com/SteamDeckHomebrew/`
- Reference plugin: `github.com/jurassicplayer/decky-autosuspend` (toast + sound patterns)
- Wiki: wiki.deckbrew.xyz · Help: deckbrew.xyz/discord

## 13. Working style

Concise, casual, honest assessments. Incremental changes over rewrites. Ask before big structural decisions. User knows Android, is newer to React/TS.
