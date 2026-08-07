from pathlib import Path

import structlog

from cli.discover import build_command_tree

structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.KeyValueRenderer(key_order=["event", "command"]),
    ]
)

app = build_command_tree(Path(__file__).parent / "commands", "cli.commands")
