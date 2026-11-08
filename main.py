import asyncio
import json
import os
import time

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
PATCH_KEYS = {"enabled", "interval_seconds"}  # ponytail: label/message/mode/fire_at join in Phase 5 (custom reminders)


def default_builtins():
    return [{**b, "type": "builtin", "mode": "repeat", "fire_at": None} for b in BUILTINS]


class Plugin:
    async def _main(self):
        self.master_enabled = True
        self.reminders = default_builtins()
        self.deadlines = {}  # id -> time.monotonic() deadline; never persisted (D6)
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
        if self.master_enabled and r["enabled"]:
            self.deadlines[r["id"]] = time.monotonic() + (DEV_INTERVAL or r["interval_seconds"])
        else:
            self.deadlines.pop(r["id"], None)

    def _restart_all(self):
        for r in self.reminders:
            self._restart(r)

    async def _tick_loop(self):
        while True:
            await asyncio.sleep(1)
            now = time.monotonic()
            for r in self.reminders:
                d = self.deadlines.get(r["id"])
                if d is not None and now >= d:
                    self._restart(r)
                    decky.logger.info(f"Reminder fired: {r['id']}")
                    await decky.emit("reminder_fired", r["id"], r["message"])

    # ---- bridge ----

    def _state(self):
        now_m, now_t = time.monotonic(), time.time()
        return {
            "master_enabled": self.master_enabled,
            "reminders": [
                {**r, "next_fire": now_t + (self.deadlines[r["id"]] - now_m) if r["id"] in self.deadlines else None}
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
        if "enabled" in patch:
            r["enabled"] = bool(patch["enabled"])
        if "interval_seconds" in patch:
            r["interval_seconds"] = self._clamp(patch["interval_seconds"])
        self._restart(r)  # D8/D9: any change restarts this countdown
        self._save()
        return self._state()

    async def _unload(self):
        self.task.cancel()
        decky.logger.info("Break Buddy unloaded, tick loop stopped")

    async def _uninstall(self):
        decky.logger.info("Break Buddy uninstalled")
