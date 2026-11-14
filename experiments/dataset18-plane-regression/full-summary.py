import hashlib
import json
import re
import sys
from pathlib import Path

for argument in sys.argv[1:]:
    directory = Path(argument)
    for path in sorted(directory.rglob("benchmark-result.json")):
        report = json.loads(path.read_text())
        assert report["scenarioCount"] == 16, report["scenarioCount"]
        assert len(report["tests"]) == 16, len(report["tests"])
        assert report["runtime"]["workerCount"] == 3, report["runtime"]
        assert report["runtime"]["bunVersion"] == "1.4.2", report["runtime"]
        cards = re.findall(r'<section class="snapshot">([\s\S]*?)</section>', path.with_name("benchmark-snapshots.html").read_text())
        hashes = {
            re.search(r"<dt>Scenario</dt><dd>([^<]+)</dd>", card)[1]: hashlib.sha256(re.search(r"<svg\b[\s\S]*?</svg>", card)[0].encode()).hexdigest()
            for card in cards
        }
        result = {
            "pass": str(path.parent.relative_to(directory)),
            "order": directory.name,
            "runtime": report["runtime"],
            "summary": report["summary"],
            "samples": [{
                "sample": row["scenarioName"],
                "elapsedTimeMs": row["elapsedTimeMs"],
                "didSolve": row["didSolve"],
                "didTimeout": row["didTimeout"],
                "sampleTimeoutMs": row["sampleTimeoutMs"],
                "relaxedDrcPassed": row["relaxedDrcPassed"],
                "drcErrorCount": row.get("drcErrorCount"),
                "viaCount": row.get("viaCount"),
                "routingMetrics": row.get("routingMetrics"),
                "stageTiming": row.get("stageTiming"),
                "svgHash": hashes.get(row["scenarioName"]),
                "peakRssBytes": row.get("peakRssBytes"),
            } for row in report["tests"]],
            "processTimes": path.with_name("time.txt").read_text(),
            "hostStart": json.loads(path.with_name("host-start.json").read_text()),
            "hostEnd": json.loads(path.with_name("host-end.json").read_text()),
        }
        print("FULL_REPORT", json.dumps(result, separators=(",", ":")))
