"""Read-only checks for the original standalone indicator/backtest references."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as folder:
    target=Path(folder)
    (target/'tests'/'fixtures').mkdir(parents=True)
    subprocess.run([sys.executable,str(root/'tests/reference/generate-indicators.py')],cwd=target,check=True)
    assert json.loads((target/'tests/fixtures/indicator-reference.json').read_text()) == json.loads((root/'tests/fixtures/indicator-reference.json').read_text())
output=subprocess.check_output([sys.executable,str(root/'tests/reference/backtest-reference.py')],cwd=root,text=True)
actual=json.loads(output)
expected=json.loads((root/'tests/fixtures/backtest-reference.json').read_text())
assert actual == {key: expected[key] for key in actual}
print('Independent legacy Decimal60 indicators and Decimal80 backtest references passed (read-only).')
