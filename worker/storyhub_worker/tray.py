"""Windows tray app wrapping the worker engine (docs/components/worker.md:
"Windows tray app"). The engine runs on a background thread; pystray owns the
main thread (a Windows requirement). Menu: identity, open log, restart, quit.

pystray/Pillow are imported here (not at package import) so headless `run` works
without the GUI deps installed.
"""

from __future__ import annotations

import logging
import os

import pystray
from PIL import Image, ImageDraw

from .config import LOG_PATH, Settings
from .engine import WorkerEngine

log = logging.getLogger("storyhub_worker")


def _icon_image() -> Image.Image:
    """A small generated 'book' glyph — avoids shipping a binary asset."""
    img = Image.new("RGB", (64, 64), (32, 34, 37))
    draw = ImageDraw.Draw(img)
    draw.rectangle((14, 12, 50, 52), outline=(120, 170, 255), width=4)
    draw.line((32, 12, 32, 52), fill=(120, 170, 255), width=3)
    return img


def run_tray(settings: Settings) -> None:
    engine = WorkerEngine(settings)
    engine.start()

    def on_open_log(icon: pystray.Icon, item: pystray.MenuItem) -> None:
        try:
            os.startfile(LOG_PATH)  # type: ignore[attr-defined]  # Windows only
        except OSError as exc:
            log.warning("could not open log: %s", exc)

    def on_restart(icon: pystray.Icon, item: pystray.MenuItem) -> None:
        engine.stop()
        engine.start()
        log.info("engine restarted from tray")

    def on_quit(icon: pystray.Icon, item: pystray.MenuItem) -> None:
        log.info("quit requested from tray")
        engine.stop()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem(f"StoryHub Worker — {settings.worker_id}", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Open log", on_open_log),
        pystray.MenuItem("Restart engine", on_restart),
        pystray.MenuItem("Quit", on_quit),
    )
    pystray.Icon("storyhub", _icon_image(), "StoryHub Worker", menu).run()
