import decky


class Plugin:
    async def _main(self):
        decky.logger.info("Break Buddy loaded")

    async def _unload(self):
        decky.logger.info("Break Buddy unloaded")

    async def _uninstall(self):
        decky.logger.info("Break Buddy uninstalled")
