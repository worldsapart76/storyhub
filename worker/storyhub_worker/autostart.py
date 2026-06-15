"""Windows autostart via the HKCU Run key (docs/components/worker.md:
"autostart on login"). Windows-only by design (CLAUDE.md hard rule).

The registered command bakes in the absolute checkout path and launches with
pythonw.exe, so the tray starts silently at login regardless of the working
directory Windows happens to hand it.
"""

from __future__ import annotations

import sys
from pathlib import Path

_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_VALUE_NAME = "StoryHubWorker"


def _pythonw() -> str:
    # pythonw.exe runs without a console window; fall back to python.exe.
    exe = Path(sys.executable)
    pyw = exe.with_name("pythonw.exe")
    return str(pyw if pyw.exists() else exe)


def _command() -> str:
    # Inject the package's parent dir onto sys.path so `import storyhub_worker`
    # resolves no matter the login cwd, then call the CLI's main().
    pkg_parent = Path(__file__).resolve().parent.parent
    boot = (
        f"import sys; sys.path.insert(0, r'{pkg_parent}'); "
        f"from storyhub_worker.cli import main; main()"
    )
    return f'"{_pythonw()}" -c "{boot}"'


def install() -> str:
    import winreg

    command = _command()
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
        winreg.SetValueEx(key, _VALUE_NAME, 0, winreg.REG_SZ, command)
    return command


def uninstall() -> bool:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            winreg.DeleteValue(key, _VALUE_NAME)
        return True
    except FileNotFoundError:
        return False


def is_installed() -> bool:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as key:
            winreg.QueryValueEx(key, _VALUE_NAME)
        return True
    except FileNotFoundError:
        return False
