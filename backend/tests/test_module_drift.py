"""The local desktop app (repo root) and the hosted backend share journal modules.
They must stay identical except for definitions that intentionally differ."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend" / "app" / "journal"
# backup(): the local app zips its SQLite file; the cloud exports JSON (no file to copy).
INTENTIONAL = {"workspace.py": {"backup"}, "news.py": set()}


def definitions(path):
    source = path.read_text()
    out = {}
    for node in ast.parse(source).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out[node.name] = ast.get_source_segment(source, node)
        elif isinstance(node, ast.Assign):
            out[ast.unparse(node.targets[0])] = ast.get_source_segment(source, node)
    return out


def test_shared_journal_modules_do_not_drift():
    for name, allowed in INTENTIONAL.items():
        local, hosted = definitions(ROOT / name), definitions(BACKEND / name)
        assert set(local) == set(hosted), f"{name}: definitions exist on one side only: {set(local) ^ set(hosted)}"
        drifted = {key for key in local if local[key] != hosted[key]} - allowed
        assert not drifted, f"{name}: update both copies of {sorted(drifted)}"
