import asyncio
import json
import os
import time
import uuid

import decky

SCHEMA_VERSION = 1
SETTINGS_FILE = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")

# Phase 3 testing: set DEV_INTERVAL to e.g. 15 to make every repeat fire after 15 s (overrides sliders).
DEV_INTERVAL = None

BUILTINS = [
    {"id": "eye", "label": "Eye break", "message": "Eye break: look 20 ft away for 20 sec", "interval_seconds": 1200, "enabled": True},
    {"id": "water", "label": "Hydration", "message": "Drink some water", "interval_seconds": 1800, "enabled": False},
    {"id": "posture", "label": "Posture check", "message": "Posture check: sit up, relax shoulders", "interval_seconds": 1200, "enabled": False},
    {"id": "wrist", "label": "Hand/wrist stretch", "message": "Stretch your hands and wrists", "interval_seconds": 2700, "enabled": False},
]
PATCH_KEYS = {"enabled", "interval_seconds", "label", "message", "mode", "fire_at"}
CUSTOM_ONLY_KEYS = {"label", "message", "mode", "fire_at"}  # built-ins only get enabled + interval


def default_builtins():
    return [{**b, "type": "builtin", "mode": "repeat", "fire_at": None} for b in BUILTINS]


class Plugin:
    async def _main(self):
        self.master_enabled = True
        self.reminders = default_builtins()
        self.deadlines = {}  # id -> time.monotonic() deadline; never persisted (D6)
        self.pending = []  # fired while the frontend wasn't listening: {id, title, ts}
        self.listening = False
        self._load()
        self._restart_all()
        self.task = asyncio.create_task(self._tick_loop())
        decky.logger.info("Break Buddy loaded, tick loop started")

    # ---- persistence ----

    def _load(self):
        try:
            with open(SETTINGS_FILE) as f:
                data = json.load(f)
            saved = {r["id"]: r for r in data["reminders"]}
            self.master_enabled = bool(data["master_enabled"])
            for r in self.reminders:
                s = saved.get(r["id"])
                if s:
                    r["enabled"] = bool(s["enabled"])
                    r["interval_seconds"] = self._clamp(s["interval_seconds"])
            for s in data["reminders"]:
                if s.get("type") == "custom":
                    self.reminders.append({
                        "id": str(s["id"]), "label": str(s["label"]), "message": str(s["message"]),
                        "type": "custom", "mode": "once" if s["mode"] == "once" else "repeat",
                        "interval_seconds": self._clamp(s["interval_seconds"]),
                        "fire_at": s.get("fire_at"), "enabled": bool(s["enabled"]),
                    })
        except FileNotFoundError:
            pass
        except Exception as e:  # corrupt file: fall back to defaults rather than crash the plugin
            decky.logger.error(f"Could not read settings, using defaults: {e}")

    def _save(self):
        data = {
            "schema_version": SCHEMA_VERSION,
            "master_enabled": self.master_enabled,
            "reminders": self.reminders,
        }
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        tmp = SETTINGS_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, SETTINGS_FILE)  # atomic

    # ---- timers ----

    @staticmethod
    def _clamp(seconds) -> int:
        # 5..120 min, snapped to 5-min steps
        return min(7200, max(300, round(int(seconds) / 300) * 300))

    def _restart(self, r):
        if self.master_enabled and r["enabled"] and r["mode"] == "repeat":
            self.deadlines[r["id"]] = time.monotonic() + (DEV_INTERVAL or r["interval_seconds"])
        else:
            self.deadlines.pop(r["id"], None)

    def _restart_all(self):
        for r in self.reminders:
            self._restart(r)

    async def _fire(self, r):
        decky.logger.info(f"Reminder fired: {r['id']}")
        if self.listening:
            await decky.emit("reminder_fired", r["id"], r["message"])
        else:
            self.pending = (self.pending + [{"id": r["id"], "title": r["message"], "ts": time.time()}])[-10:]

    async def _tick_loop(self):
        last_m, last_t = time.monotonic(), time.time()
        while True:
            await asyncio.sleep(1)
            now_m, now_t = time.monotonic(), time.time()
            # CLOCK_MONOTONIC stops during suspend, wall clock doesn't: a gap means we just resumed.
            # Repeat deadlines are monotonic so they already resume with time left (D1/D2, no burst).
            resumed = (now_t - last_t) - (now_m - last_m) > 5
            last_m, last_t = now_m, now_t
            changed = False
            for r in list(self.reminders):
                if not self.master_enabled or not r["enabled"]:
                    continue
                if r["mode"] == "once":
                    # wall-clock; also covers overdue-on-startup and overdue-on-resume (fires once)
                    if r["fire_at"] is not None and now_t >= r["fire_at"]:
                        self.reminders.remove(r)  # one-shots are removed after firing
                        changed = True
                        await self._fire(r)
                else:
                    d = self.deadlines.get(r["id"])
                    if d is not None and now_m >= d:
                        self._restart(r)
                        await self._fire(r)
            if changed:
                self._save()
            if resumed or changed:
                await decky.emit("state_changed")

    # ---- bridge ----

    def _state(self):
        now_m, now_t = time.monotonic(), time.time()
        return {
            "master_enabled": self.master_enabled,
            "reminders": [
                {**r, "next_fire": r["fire_at"] if r["mode"] == "once" else (now_t + (self.deadlines[r["id"]] - now_m) if r["id"] in self.deadlines else None)}
                for r in self.reminders
            ],
        }

    async def get_state(self):
        return self._state()

    async def set_master(self, enabled: bool):
        self.master_enabled = bool(enabled)
        self._restart_all()
        self._save()
        return self._state()

    async def update_reminder(self, id: str, patch: dict):
        r = next((r for r in self.reminders if r["id"] == id), None)
        if r is None:
            raise ValueError(f"Unknown reminder: {id}")
        if not set(patch) <= PATCH_KEYS:
            raise ValueError(f"Unknown patch keys: {set(patch) - PATCH_KEYS}")
        if r["type"] == "builtin" and set(patch) & CUSTOM_ONLY_KEYS:
            raise ValueError("Built-in reminders only allow enabled and interval_seconds")
        if "enabled" in patch:
            r["enabled"] = bool(patch["enabled"])
        if "interval_seconds" in patch:
            r["interval_seconds"] = self._clamp(patch["interval_seconds"])
        for k in ("label", "message"):
            if k in patch:
                r[k] = str(patch[k]).strip()[:100] or r[k]
        if "mode" in patch:
            if patch["mode"] not in ("once", "repeat"):
                raise ValueError("mode must be once or repeat")
            r["mode"] = patch["mode"]
        if "fire_at" in patch:
            r["fire_at"] = float(patch["fire_at"])
        if r["mode"] == "once" and r["fire_at"] is None:
            raise ValueError("One-shot needs fire_at")
        if r["mode"] == "repeat":
            r["fire_at"] = None
        self._restart(r)  # D8/D9: any change restarts this countdown
        self._save()
        return self._state()

    async def add_custom(self, label: str, mode: str, minutes: int):
        if mode not in ("once", "repeat"):
            raise ValueError("mode must be once or repeat")
        label = str(label).strip()[:100]
        if not label:
            raise ValueError("Label required")
        secs = self._clamp(int(minutes) * 60)
        r = {
            "id": uuid.uuid4().hex, "label": label, "message": label, "type": "custom", "mode": mode,
            "interval_seconds": secs, "fire_at": time.time() + secs if mode == "once" else None, "enabled": True,
        }
        self.reminders.append(r)
        self._restart(r)
        self._save()
        return self._state()

    async def delete_reminder(self, id: str):
        r = next((r for r in self.reminders if r["id"] == id), None)
        if r is None or r["type"] != "custom":
            raise ValueError(f"Not a custom reminder: {id}")
        self.reminders.remove(r)
        self.deadlines.pop(id, None)
        self._save()
        return self._state()

    async def frontend_ready(self):
        # Steam UI (re)loaded: hand over what fired while nobody was listening, skipping stale items (>10 min)
        self.listening = True
        items, self.pending = [p for p in self.pending if time.time() - p["ts"] < 600], []
        return items

    async def frontend_gone(self):
        self.listening = False

    async def _unload(self):
        self.task.cancel()
        decky.logger.info("Break Buddy unloaded, tick loop stopped")

    async def _uninstall(self):
        decky.logger.info("Break Buddy uninstalled")
