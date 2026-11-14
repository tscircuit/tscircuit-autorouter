"""Inspect existing artifacts. No solver or circuit renderer is executed."""
import base64
import io
import json
import os
from pathlib import Path
import zipfile

def artifact_root(folder):
    summaries = list(Path(folder).rglob("summary.json"))
    if len(summaries) != 1:
        raise ValueError(f"Expected one artifact summary in {folder}, got {len(summaries)}")
    return summaries[0].parent


root = artifact_root("evidence-demands")
rows = json.loads((root / "summary.json").read_text())
audits = []
for board_id in ["orangecrab", "h616", "butterstick", "glider", "imx6", "icepi"]:
    before = json.loads((root / f"{board_id}-baseline-requests.srj.json").read_text())
    after = json.loads((root / f"{board_id}-connected_regions-requests.srj.json").read_text())
    original = json.loads((root / f"{board_id}-plane-input.srj.json").read_text())
    assert before["obstacles"] == after["obstacles"], f"Copper geometry changed: {board_id}"
    assert before["obstacles"][:len(original["obstacles"])] == original["obstacles"]
    assert {k: v for k, v in before.items() if k != "connections"} == {k: v for k, v in after.items() if k != "connections"}
    original_points = {p["pointId"] for c in original["connections"] for p in c["pointsToConnect"] if p.get("pointId")}
    before_points = {p["pointId"] for c in before["connections"] for p in c["pointsToConnect"] if p.get("pointId")}
    after_points = {p["pointId"] for c in after["connections"] for p in c["pointsToConnect"] if p.get("pointId")}
    newly_missing = sorted((original_points - after_points) - (original_points - before_points))
    assert not newly_missing, f"Lost source terminals: {board_id}"
    audits.append({"id": board_id, "identicalOriginalAndEscapeObstacles": True,
                   "identicalConstraintsOutsideRequestedConnections": True,
                   "originalPointIds": len(original_points),
                   "missingBefore": len(original_points-before_points),
                   "missingAfter": len(original_points-after_points),
                   "newlyMissingTerminals": newly_missing})
result = {"demandRows": rows, "physicalGeometryAudits": audits}

if os.environ.get("INCLUDE_FULL") == "true":
    folders = {label: artifact_root(f"evidence-{label}") for label in ["control", "fixed"]}
    for label, folder in folders.items():
        result[label] = {"environment": json.loads((folder/"environment.json").read_text()),
                         "cases": json.loads((folder/"summary.json").read_text())}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for label, folder in folders.items():
            for file in folder.rglob("pcb.svg"):
                archive.writestr(f"{label}/{file.parent.name}/pcb.svg", file.read_bytes())
    print("PLANE_PCB_ZIP_BEGIN")
    encoded = base64.b64encode(stream.getvalue()).decode()
    for index in range(0,len(encoded),8000):
        print(encoded[index:index+8000])
    print("PLANE_PCB_ZIP_END")

Path("plane-evidence-summary.json").write_text(json.dumps(result,indent=2))
print("PLANE_EVIDENCE_SUMMARY_BEGIN")
print(json.dumps(result,separators=(",",":")))
print("PLANE_EVIDENCE_SUMMARY_END")
