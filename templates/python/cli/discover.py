from __future__ import annotations

import importlib
from pathlib import Path

import typer


def build_command_tree(commands_dir: Path, package_name: str) -> typer.Typer:
    root = typer.Typer()
    _mount_dir(root, commands_dir, package_name)
    return root


def _mount_dir(parent_app: typer.Typer, dir_path: Path, package_name: str) -> None:
    for entry in sorted(dir_path.iterdir()):
        if entry.is_dir() and (entry / "__init__.py").exists():
            group_app = typer.Typer()
            _mount_dir(group_app, entry, f"{package_name}.{entry.name}")
            parent_app.add_typer(group_app, name=entry.name)
        elif entry.suffix == ".py" and entry.stem != "__init__":
            module = importlib.import_module(f"{package_name}.{entry.stem}")
            leaf_app = getattr(module, "app")
            parent_app.add_typer(leaf_app, name=entry.stem)
