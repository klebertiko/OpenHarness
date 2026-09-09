import argparse
import json
import sys
from pathlib import Path

from .validate import validate_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="oharness")
    sub = parser.add_subparsers(dest="cmd", required=True)
    validate_parser = sub.add_parser("validate")
    validate_parser.add_argument("path", type=Path)

    args = parser.parse_args(argv)
    if args.cmd == "validate":
        result = validate_path(args.path)
        print(json.dumps({"ok": result.ok, "errors": result.errors}, indent=2))
        return 0 if result.ok else 1
    return 2
