import asyncio
import time

import decky

# Phase 2 scaffolding: one hardcoded repeat. Set DEV_INTERVAL to e.g. 15 for quick testing.
DEV_INTERVAL = None
INTERVAL = DEV_INTERVAL or 20 * 60
MESSAGE = "Eye break: look 20 ft away for 20 sec"


class Plugin:
    async def _main(self):
        self.enabled = True
        self.deadline = time.monotonic() + INTERVAL
        self.task = asyncio.create_task(self._tick_loop())
        decky.logger.info("Break Buddy loaded, tick loop started")

    async def _tick_loop(self):
        while True:
            await asyncio.sleep(1)
            if self.enabled and time.monotonic() >= self.deadline:
                self.deadline = time.monotonic() + INTERVAL
                decky.logger.info("Reminder fired")
                await decky.emit("reminder_fired", "eye", MESSAGE)

    async def get_enabled(self) -> bool:
        return self.enabled

    async def set_enabled(self, enabled: bool) -> bool:
        self.enabled = enabled
        self.deadline = time.monotonic() + INTERVAL  # D9: re-enable restarts full interval
        decky.logger.info(f"Enabled set to {enabled}")
        return self.enabled

    async def _unload(self):
        self.task.cancel()
        decky.logger.info("Break Buddy unloaded, tick loop stopped")

    async def _uninstall(self):
        decky.logger.info("Break Buddy uninstalled")
