"""Adapter boundary: only adapters/ and dashboard/ may import FastAPI/Starlette."""

import ast
from pathlib import Path

PKG = Path(__file__).resolve().parent.parent / "nahiarhdLOG"
ALLOWED_TOP = {"adapters", "dashboard"}
BANNED_ROOTS = {"fastapi", "starlette"}


def _imports_of(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module.split(".")[0])
    return found


def test_core_does_not_import_web_framework():
    offenders = []
    for path in sorted(PKG.rglob("*.py")):
        rel = path.relative_to(PKG)
        if rel.parts[0] in ALLOWED_TOP or path.name == "__init__.py" and len(rel.parts) == 1:
            # Top-level __init__ uses a lazy import inside a function; check it too,
            # but allow it only when nested (not module top-level).
            if len(rel.parts) == 1 and path.name == "__init__.py":
                tree = ast.parse(path.read_text())
                top = set()
                for node in tree.body:
                    if isinstance(node, ast.Import):
                        top.update(a.name.split(".")[0] for a in node.names)
                    elif isinstance(node, ast.ImportFrom) and node.module:
                        top.add(node.module.split(".")[0])
                banned = top & BANNED_ROOTS
                if banned:
                    offenders.append(f"{rel}: top-level {sorted(banned)}")
                continue
            continue
        banned = _imports_of(path) & BANNED_ROOTS
        if banned:
            offenders.append(f"{rel}: {sorted(banned)}")
    assert not offenders, "framework imports leaked into core: " + "; ".join(offenders)
