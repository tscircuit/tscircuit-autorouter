This focused integration check replays the actual iCE/Pi U22 pin101 escape
through published core 0.0.2410. It verifies that core materializes its 0.45/0.2mm
via across all four copper layers and that the final foreign inner1 pour BREP
contains the required 0.1mm clearance around that via.

Run with Bun and the installed full-board reproduction dependencies:

```bash
bash reproduce.sh /path/to/full-board-models/node_modules
```

The script downloads core 0.0.2410 and props 0.0.735 into an isolated temporary
directory. It uses the supplied dependencies for the remaining imports, records
versions and hashes, and leaves the supplied installation unchanged.

The integration board has two ground pads and replays one captured fanout
prefix, remapping source-port IDs to this integration board. Its unrelated
missing-connection findings are included in `result.json`;
this check establishes barrel materialization and regenerated pour clearance,
not full-board routing completion. Geometry in `native-plane-drop.json` comes
from the committed native fanout reproduction, without a change to via rules.
