import hashlib
import json
import re
import statistics
import sys
from pathlib import Path


def stable_metrics(value):
    if isinstance(value, dict):
        return {
            key: stable_metrics(item)
            for key, item in value.items()
            if key not in {"elapsedTimeMs", "timeMs", "phaseTimeMs"}
        }
    if isinstance(value, list):
        return [stable_metrics(item) for item in value]
    return value


for argument in sys.argv[1:]:
    directory = Path(argument)
    reports = {}
    for path in sorted(directory.rglob("benchmark-result.json")):
        label = str(path.parent.relative_to(directory))
        report = json.loads(path.read_text())
        html_path = path.with_name("benchmark-snapshots.html")
        images = re.findall(r"<svg\b[\s\S]*?</svg>", html_path.read_text())
        image_hashes = {
            row["scenarioName"]: hashlib.sha256(image.encode()).hexdigest()
            for row, image in zip(report["snapshots"], images, strict=True)
        }
        report["svgHashes"] = image_hashes
        reports[label] = report
        print("REPORT", argument, label, json.dumps({
            "runtime": report.get("runtime"),
            "summary": report["summary"],
            "samples": [{
                "sample": row["scenarioName"],
                "elapsedTimeMs": row["elapsedTimeMs"],
                "didSolve": row["didSolve"],
                "relaxedDrcPassed": row["relaxedDrcPassed"],
                "viaCount": row.get("viaCount"),
                "routingMetrics": row.get("routingMetrics"),
                "stageTiming": row.get("stageTiming"),
                "svgHash": image_hashes.get(row["scenarioName"]),
            } for row in report["tests"]],
        }, separators=(",", ":")))
    if "base" in reports and "pr" in reports:
        before = {row["scenarioName"]: row for row in reports["base"]["tests"]}
        after = {row["scenarioName"]: row for row in reports["pr"]["tests"]}
        for sample in sorted(before):
            first, second = before[sample], after[sample]
            print("COMPARE", argument, sample, json.dumps({
                "baseMs": first["elapsedTimeMs"],
                "prMs": second["elapsedTimeMs"],
                "equalRoutingMetricsWithoutTime": stable_metrics(first.get("routingMetrics")) == stable_metrics(second.get("routingMetrics")),
                "equalOutcome": all(first.get(key) == second.get(key) for key in ["didSolve", "didTimeout", "relaxedDrcPassed", "viaCount", "drcErrorCount", "traceLintIssueCounts"]),
                "equalSvg": reports["base"]["svgHashes"][sample] == reports["pr"]["svgHashes"][sample],
            }, separators=(",", ":")))
    else:
        grouped = {}
        for label, report in reports.items():
            revision = label.split("-")[0]
            for row in report["tests"]:
                grouped.setdefault(row["scenarioName"], {}).setdefault(revision, []).append(row)
        for sample, revisions in sorted(grouped.items()):
            timings = {revision: [row["elapsedTimeMs"] for row in rows] for revision, rows in revisions.items()}
            metrics = [stable_metrics(row.get("routingMetrics")) for rows in revisions.values() for row in rows]
            print("COUNTERBALANCED", sample, json.dumps({
                "timesMs": timings,
                "medianPrVsBasePct": (statistics.median(timings["pr"]) / statistics.median(timings["base"]) - 1) * 100,
                "allRoutingMetricsEqualWithoutTime": all(item == metrics[0] for item in metrics),
                "svgHashes": {label: report["svgHashes"][sample] for label, report in reports.items()},
            }, separators=(",", ":")))
