"""Command-line entry for the StoryHub worker.

  python -m storyhub_worker                  # start the tray app (default)
  python -m storyhub_worker run              # run headless (no tray) — dev/debug
  python -m storyhub_worker config           # show settings + autostart state
  python -m storyhub_worker install-autostart
  python -m storyhub_worker uninstall-autostart
"""

from __future__ import annotations

import argparse
import logging
import sys

from . import autostart
from .config import SETTINGS_PATH, load_settings
from .engine import WorkerEngine
from .logging_setup import setup_logging


def _require_config(settings) -> None:
    if not settings.is_configured():
        print(
            "Worker is not configured yet.\n"
            f"Edit {SETTINGS_PATH} and set 'railway_url' and 'auth_token', "
            "then start the worker again."
        )
        sys.exit(1)


def cmd_run(args: argparse.Namespace) -> None:
    log = setup_logging(logging.DEBUG if args.verbose else logging.INFO)
    settings = load_settings()
    _require_config(settings)
    engine = WorkerEngine(settings)
    try:
        engine.run()  # blocks on the main thread; Ctrl-C to stop
    except KeyboardInterrupt:
        log.info("Interrupted — shutting down")
        engine.stop()


def cmd_tray(args: argparse.Namespace) -> None:
    setup_logging(logging.DEBUG if args.verbose else logging.INFO)
    settings = load_settings()
    _require_config(settings)
    from .tray import run_tray  # lazy: keeps GUI deps optional for headless run

    run_tray(settings)


def cmd_config(args: argparse.Namespace) -> None:
    settings = load_settings()
    print(f"Settings file: {SETTINGS_PATH}")
    print(f"  railway_url : {settings.railway_url or '(unset)'}")
    print(f"  auth_token  : {'(set)' if settings.auth_token else '(unset)'}")
    print(f"  worker_id   : {settings.worker_id}")
    print(f"  poll        : {settings.poll_interval_seconds}s")
    print(f"  heartbeat   : {settings.heartbeat_interval_seconds}s")
    print(f"  autostart   : {'installed' if autostart.is_installed() else 'not installed'}")


def cmd_install_autostart(args: argparse.Namespace) -> None:
    command = autostart.install()
    print(f"Autostart installed (HKCU Run -> StoryHubWorker):\n  {command}")


def cmd_uninstall_autostart(args: argparse.Namespace) -> None:
    print("Autostart removed." if autostart.uninstall() else "Autostart was not installed.")


def main(argv: list[str] | None = None) -> None:
    # -v on a shared parent so it's accepted both before and after the command
    # (`storyhub_worker -v run` and `storyhub_worker run -v` both work).
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("-v", "--verbose", action="store_true", help="debug logging")

    parser = argparse.ArgumentParser(
        prog="storyhub_worker", description="StoryHub local worker", parents=[common]
    )
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("run", help="run headless (no tray)", parents=[common])
    sub.add_parser("tray", help="start the tray app (default)", parents=[common])
    sub.add_parser("config", help="show settings + autostart state", parents=[common])
    sub.add_parser("install-autostart", help="start the worker at login (HKCU Run)", parents=[common])
    sub.add_parser("uninstall-autostart", help="remove login autostart", parents=[common])
    args = parser.parse_args(argv)

    dispatch = {
        "run": cmd_run,
        "tray": cmd_tray,
        "config": cmd_config,
        "install-autostart": cmd_install_autostart,
        "uninstall-autostart": cmd_uninstall_autostart,
        None: cmd_tray,  # bare `python -m storyhub_worker` -> tray
    }
    dispatch[args.command](args)
