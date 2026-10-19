#!/usr/bin/env python3
"""Read benchmark data only; never import or execute anything from an artifact."""

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import sys
import urllib.request

RUNS = (
    ("dataset01", "39309110611"),
    ("dataset01", "39310925313"),
    ("dataset01", "39310948565"),
    ("srj18", "39309073322"),
    ("srj18", "39309836344"),
    ("srj18", "39309860798"),
    ("srj24", "39309090786"),
)
IGNORED = frozenset(("elapsedTimeMs", "peakRssBytes", "timeMs", "phaseTimeMs"))
SOLVER = "AutoroutingPipelineSolver9_PreloadedTraceGraph"
CARD_RE = re.compile(r'<section class="snapshot">(.*?)</section>', re.DOTALL)
FIELD_RE = re.compile(r"<dt>([^<]+)</dt>\s*<dd>(.*?)</dd>", re.DOTALL)
SVG_RE = re.compile(r"<svg\b.*?</svg>", re.DOTALL)
DETAIL_LIMIT = 20
TIMEOUT_FIELDS = ("pipelineIterations", "phaseIterations", "pipelineProgress", "phaseProgress")
TIMEOUT_RE = re.compile(
    r"Timed out after \d+(?:\.\d+)?s\nLast progress: phase=[^,\n]+, solver=[^,\n]+, "
    r"pipelineIterations=(?P<pipelineIterations>\d+), phaseIterations=(?P<phaseIterations>\d+), "
    r"pipelineProgress=(?P<pipelineProgress>\d+(?:\.\d+)?)%, "
    r"phaseProgress=(?P<phaseProgress>\d+(?:\.\d+)?)%"
)
TIMEOUT_CLASSIFICATION = (
    "Only /error differences between two didTimeout=true rows may be classified: both complete "
    "messages must match the known timeout-progress format and become identical after replacing "
    "only pipelineIterations, phaseIterations, pipelineProgress and phaseProgress numeric values. "
    "Timeout duration, phase, solver and all other text remain exact. Raw messages and numeric "
    "observations are retained; classified differences do not mean exact record equality."
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def key(record):
    result = (record["solverName"], record["scenarioName"], record["sampleNumber"])
    require(all(isinstance(x, str) and x for x in result[:2]), "Invalid row key")
    require(type(result[2]) is int and result[2] > 0, "Invalid sample number")
    return result


def normalize(value):
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items() if k not in IGNORED}
    if isinstance(value, list):
        return [normalize(x) for x in value]
    return value


def digest(value):
    raw = value if isinstance(value, str) else json.dumps(value, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def index(records):
    result = {}
    for record in records:
        identity = key(record)
        require(identity not in result, "Duplicate row key: " + repr(identity))
        result[identity] = record
    return result


def extract_svgs(document, dataset):
    result = {}
    cards = CARD_RE.findall(document)
    for card in cards:
        pairs = [(html.unescape(k), html.unescape(v)) for k, v in FIELD_RE.findall(card)]
        fields = dict(pairs)
        require(len(fields) == len(pairs), "Duplicate snapshot metadata labels")
        require(fields["Dataset"] == dataset, "Unexpected snapshot dataset")
        identity = key({"solverName": fields["Solver"], "scenarioName": fields["Scenario"],
                        "sampleNumber": int(fields["Sample"])})
        images = SVG_RE.findall(card)
        require(len(images) == 1, "Expected exactly one SVG per snapshot")
        require(identity not in result, "Duplicate SVG key: " + repr(identity))
        result[identity] = images[0]
    require(len(result) == len(SVG_RE.findall(document)), "Unattributed SVG outside snapshot cards")
    return result


def load_revision(root, dataset):
    report = json.loads((root / "benchmark-result.json").read_text(encoding="utf-8"))
    require(report["version"] == 1, "Unexpected benchmark report version")
    require(report["datasetName"] == dataset, "Unexpected report dataset")
    rows = index(report["tests"])
    require(rows and all(k[0] == SOLVER for k in rows), "Unexpected or empty solver results")
    require(report["scenarioCount"] == len(rows), "Missing or extra per-board results")
    require(all(type(r["didSolve"]) is bool and type(r["didTimeout"]) is bool
                and type(r["relaxedDrcPassed"]) is bool for r in rows.values()), "Invalid result flags")
    snapshots = index(report["snapshots"])
    expected = {k: r["benchmarkSnapshot"] for k, r in rows.items() if "benchmarkSnapshot" in r}
    require(normalize(snapshots) == normalize(expected), "Snapshot metadata differs from report rows")
    images = extract_svgs((root / "benchmark-snapshots.html").read_text(encoding="utf-8"), dataset)
    require(images.keys() == snapshots.keys(), "Missing or extra SVGs compared with report metadata")
    require(all(rows[k]["didSolve"] for k in images), "SVG attributed to an unsolved board")
    return report, rows, images


def differences(base, candidate, path=""):
    if type(base) is not type(candidate):
        yield path
    elif isinstance(base, dict):
        for name in sorted(base.keys() | candidate.keys()):
            child = path + "/" + str(name)
            if name not in base or name not in candidate:
                yield child
            else:
                yield from differences(base[name], candidate[name], child)
    elif isinstance(base, list):
        if len(base) != len(candidate):
            yield path + "/length"
        for i, (a, b) in enumerate(zip(base, candidate)):
            yield from differences(a, b, path + "/" + str(i))
    elif base != candidate:
        yield path


def timeout_progress_difference(base, candidate):
    if base.get("didTimeout") is not True or candidate.get("didTimeout") is not True:
        return None
    parsed = []
    for row in (base, candidate):
        error = row.get("error")
        match = TIMEOUT_RE.fullmatch(error) if isinstance(error, str) else None
        if match is None:
            return None
        masked = error
        for field in reversed(TIMEOUT_FIELDS):
            masked = masked[:match.start(field)] + "<" + field + ">" + masked[match.end(field):]
        counters = {name: int(match[name]) if name.endswith("Iterations") else float(match[name])
                    for name in TIMEOUT_FIELDS}
        parsed.append({"masked": masked, "rawError": error, "numericCounters": counters})
    if parsed[0]["masked"] != parsed[1]["masked"]:
        return None
    return {side: {k: v for k, v in value.items() if k != "masked"}
            for side, value in zip(("base", "pr"), parsed)}


def counts(rows, images):
    values = list(rows.values())
    return {
        "boards": len(rows), "solved": sum(r["didSolve"] for r in values),
        "failed": sum(not r["didSolve"] for r in values),
        "timedOut": sum(r["didTimeout"] for r in values),
        "drcPassed": sum(r["relaxedDrcPassed"] for r in values),
        "reportedDrcErrors": sum(r.get("drcErrorCount", 0) for r in values),
        "boardsWithoutDrcCount": sum("drcErrorCount" not in r for r in values),
        "reportedVias": sum(r.get("viaCount", 0) for r in values),
        "reportedLintIssues": sum(sum(r.get("traceLintIssueCounts", {}).values()) for r in values),
        "svgCount": len(images),
        "solvedWithoutSvg": sum(r["didSolve"] and k not in images for k, r in rows.items()),
    }


def compare_pair(dataset, run_id, root):
    base_report, base, base_images = load_revision(root / "base", dataset)
    pr_report, candidate, pr_images = load_revision(root / "pr", dataset)
    require(base_report["effortLabel"] == pr_report["effortLabel"], "Effort differs between revisions")
    changed, unclassified, timeout_observations = [], [], []
    missing_base, missing_pr = sorted(candidate.keys() - base.keys()), sorted(base.keys() - candidate.keys())
    for identity in sorted(base.keys() & candidate.keys()):
        a, b = normalize(base[identity]), normalize(candidate[identity])
        paths = list(differences(a, b))
        if paths:
            changed.append({"key": identity, "changedFieldCount": len(paths),
                            "paths": paths[:DETAIL_LIMIT], "baseSha256": digest(a), "prSha256": digest(b)})
            observation = timeout_progress_difference(base[identity], candidate[identity]) if "/error" in paths else None
            if observation is not None:
                timeout_observations.append({"key": identity, **observation})
            remaining = [p for p in paths if p != "/error" or observation is None]
            if remaining:
                unclassified.append({"key": identity, "changedFieldCount": len(remaining),
                                     "paths": remaining[:DETAIL_LIMIT]})
    svg_changed = [{"key": k, "baseSha256": digest(base_images[k]), "prSha256": digest(pr_images[k])}
                   for k in sorted(base_images.keys() & pr_images.keys()) if base_images[k] != pr_images[k]]
    svg_missing_base = sorted(pr_images.keys() - base_images.keys())
    svg_missing_pr = sorted(base_images.keys() - pr_images.keys())
    base_counts, pr_counts = counts(base, base_images), counts(candidate, pr_images)
    verified = not (unclassified or missing_base or missing_pr or svg_changed or svg_missing_base or svg_missing_pr
                    or base_counts["solvedWithoutSvg"] or pr_counts["solvedWithoutSvg"])
    return {"runId": run_id, "dataset": dataset, "verified": verified,
            "exactNonTimingRecordsEqual": not (changed or missing_base or missing_pr),
            "exactSvgsEqual": not (svg_changed or svg_missing_base or svg_missing_pr),
            "base": base_counts, "pr": pr_counts, "changedBoardCount": len(changed),
            "changedBoards": changed[:DETAIL_LIMIT], "missingBaseBoards": missing_base,
            "missingPrBoards": missing_pr, "changedSvgCount": len(svg_changed),
            "changedSvgs": svg_changed[:DETAIL_LIMIT], "missingBaseSvgs": svg_missing_base,
            "missingPrSvgs": svg_missing_pr, "unclassifiedChangedBoardCount": len(unclassified),
            "unclassifiedChangedBoards": unclassified[:DETAIL_LIMIT],
            "timeoutProgressOnlyErrorDifferenceCount": len(timeout_observations),
            "timeoutProgressDifferenceKeys": [entry["key"] for entry in timeout_observations],
            "timeoutProgressErrorDifferences": timeout_observations, "detailsLimit": DETAIL_LIMIT}


def check_runs():
    repository = os.environ["GITHUB_REPOSITORY"]
    require(repository == "tscircuit/tscircuit-autorouter", "Unexpected repository")
    token = os.environ["ARTIFACT_GITHUB_TOKEN"]
    runs = []
    for dataset, run_id in RUNS:
        request = urllib.request.Request(
            f"https://api.github.com/repos/{repository}/actions/runs/{run_id}",
            headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "pr3139-artifact-verification"},
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            run = json.load(response)
        runs.append({"runId": run_id, "dataset": dataset, "status": run["status"],
                     "conclusion": run["conclusion"], "workflowHeadSha": run["head_sha"]})
    complete = all(run["status"] == "completed" for run in runs)
    successful = all(run["conclusion"] == "success" for run in runs)
    print(json.dumps({"allRunsCompleted": complete, "allRunsSuccessful": successful, "runs": runs}, indent=2))
    require(complete and successful,
            "All seven benchmark runs must complete successfully before artifact verification")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check-runs", action="store_true")
    mode.add_argument("--pair", nargs=2, metavar=("DATASET", "DIRECTORY"), help="Local smoke comparison only")
    parser.add_argument("--artifacts-root", type=Path, default=Path("artifacts"))
    args = parser.parse_args()
    if args.check_runs:
        check_runs()
        return 0
    pairs = [(args.pair[0], "local", Path(args.pair[1]))] if args.pair else [
        (dataset, run_id, args.artifacts_root / run_id) for dataset, run_id in RUNS]
    results = []
    for dataset, run_id, root in pairs:
        try:
            results.append(compare_pair(dataset, run_id, root))
        except (OSError, ValueError, KeyError, TypeError) as error:
            results.append({"runId": run_id, "dataset": dataset, "verified": False,
                            "validationError": str(error)})
    verified = all(result["verified"] for result in results)
    print(json.dumps({"verified": verified, "recursiveExcludedFields": sorted(IGNORED),
                      "exactNonTimingRecordsEqual": all(r.get("exactNonTimingRecordsEqual", False) for r in results),
                      "timeoutProgressClassification": TIMEOUT_CLASSIFICATION,
                      "comparisons": results}, indent=2))
    observations = sum(r.get("timeoutProgressOnlyErrorDifferenceCount", 0) for r in results)
    print("\nArtifact verification: " + ("PASS" if verified else "FAIL")
          + (f" ({observations} timeout progress differences retained; records are not exact)" if observations else ""))
    for result in results:
        print(json.dumps({"runId": result["runId"], "dataset": result["dataset"],
                          "status": "PASS" if result["verified"] else "FAIL",
                          "base": result.get("base"), "pr": result.get("pr"),
                          "changedBoards": result.get("changedBoardCount"),
                          "changedSvgs": result.get("changedSvgCount"),
                          "exactNonTimingRecordsEqual": result.get("exactNonTimingRecordsEqual"),
                          "unclassifiedChangedBoards": result.get("unclassifiedChangedBoardCount"),
                          "timeoutProgressOnlyErrorDifferences": result.get("timeoutProgressOnlyErrorDifferenceCount"),
                          "error": result.get("validationError")}, sort_keys=True))
    return 0 if verified else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"verified": False, "validationError": str(error)}))
        sys.exit(1)
