import json
import sys
from pathlib import Path

variants = json.loads(Path('source-variants.json').read_text())
root = Path(sys.argv[1])
for path, text in variants[sys.argv[2]].items():
    (root / path).write_text(text)
