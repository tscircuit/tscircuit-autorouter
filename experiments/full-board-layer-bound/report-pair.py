#!/usr/bin/env python3
"""Report completion/physical tradeoffs without turning a timeout into a gain."""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path


def read_case(folder: Path) -> dict:
    result = json.loads((folder / "result.json").read_text())
    progress = json.loads((folder / "progress.json").read_text())
    assessment = json.loads((folder / "assessment.json").read_text()) if (folder / "assessment.json").exists() else None
    diagnostics = json.loads((folder / "coarse-diagnostics.json").read_text()) if (folder / "coarse-diagnostics.json").exists() else {"reports": []}
    return {"result": result, "progress": progress, "assessment": assessment, "diagnostics": diagnostics}


def connected_names(packet: dict, reference: dict, cohort: str) -> list[str] | None:
    assessment = packet["assessment"]
    if assessment is None:
        return None
    missing = [row["name"] for row in assessment["missingCopper"]] if cohort == "original" else assessment["unconnectedNets"]
    source_bytes = Path(packet["progress"]["sourcePath"]).read_bytes()
    if hashlib.sha256(source_bytes).hexdigest() != reference["sourceSha256"]:
        raise RuntimeError("Authoritative net membership source changed")
    source = json.loads(gzip.decompress(source_bytes) if cohort == "spaced" else source_bytes)
    requested = [net["nativeName"] for net in source["nets"] if net["routable"]] if cohort == "original" else [trace["nativeNet"] for trace in source["traces"] if len(trace["path"]) > 1]
    if len(set(requested)) != packet["result"]["requestedRoutableNets"]:
        raise RuntimeError("Native net-name denominator differs")
    connected = sorted(set(requested) - set(missing))
    if len(connected) != assessment["connectedNets"]:
        raise RuntimeError("Named physical net set does not match canonical assessment count")
    return connected


def published_parity(packet: dict, reference: dict, cohort: str) -> dict:
    progress, result = packet["progress"], packet["result"]
    phases = [{key: row[key] for key in ["name", "status", "connections", "solver"]} for row in progress["phases"]]
    error = str(progress["errors"][0]) if progress["errors"] else None
    blocker = "iteration_limit" if error and "ran out of iterations" in error else error
    configs = {row["phase"]: {key: value for key, value in row["configured"].items() if key != "className"} for row in packet["diagnostics"]["reports"] if row.get("configured")}
    checks = {
        "sourceSha256": progress["sourceSha256"] == reference["sourceSha256"],
        "implementationHashes": [{"name": Path(row["path"]).name, "sha256": row["sha256"]} for row in progress["implementationFiles"]] == reference["implementationHashes"],
        "countsAndListedFindings": {key: result.get(key) for key in reference["counts"]} == reference["counts"],
        "namedPhysicalConnectivity": connected_names(packet, reference, cohort) == reference["connectedNativeNetNames"],
        "phaseOrderAndOutcome": phases == reference["phases"],
        "firstBlockerClass": blocker == reference["blockerClass"],
        "nativeCoarseOptionsAndDimensions": configs == reference["coarseConfiguration"],
    }
    return {"matchesAvailablePublishedEvidence": all(checks.values()), "checks": checks,
            "publishedPhaseSrjAndCircuitHashesAvailable": False,
            "limitation": "Saved published control has no decoded full SRJ/circuit hashes; timing is from a different VM and is not a speed comparison"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--board", required=True)
    parser.add_argument("--cohort", required=True)
    parser.add_argument("--control-only", action="store_true")
    arguments = parser.parse_args()
    reference = json.loads((Path(__file__).parent / "published-reference.json").read_text())[arguments.board + "-" + arguments.cohort]
    control_folder = arguments.root / "source-base/results" / arguments.board / arguments.cohort
    control = read_case(control_folder)
    parity = published_parity(control, reference, arguments.cohort)
    (arguments.root / "published-control-parity.json").write_text(json.dumps(parity, indent=2) + "\n")
    if arguments.control_only:
        print("PUBLISHED_SOURCE_CONTROL_PARITY " + json.dumps(parity))
        if not parity["matchesAvailablePublishedEvidence"]:
            raise RuntimeError("Source control differs from the published functional reference; candidate attribution blocked")
        return
    rows = {}
    for variant in ["base", "pr"]:
        folder = arguments.root / ("source-" + variant) / "results" / arguments.board / arguments.cohort
        if not (folder / "result.json").exists():
            raise RuntimeError(f"Missing actual {variant} result")
        rows[variant] = read_case(folder)
    base, candidate = rows["base"], rows["pr"]
    static_fields = ["sourceSha256", "expectedComponents", "expectedPads", "expectedNets", "expectedRoutableNets", "mode", "fanout", "planes", "implementationFiles", "assessmentSourceFiles"]
    for key in static_fields:
        if base["progress"][key] != candidate["progress"][key]:
            raise RuntimeError(f"Authentic source/routing configuration differs: {key}")
    report = {"board": arguments.board, "cohort": arguments.cohort, "staticInputsEqual": True, "publishedSourceControlParity": parity, "variants": {}}
    for label, packet in rows.items():
        result, progress = packet["result"], packet["progress"]
        report["variants"][label] = {
            key: result.get(key) for key in ["status", "completeAndClean", "connectedNets", "requestedRoutableNets", "listedFindingCount", "sharedDrcErrorCount", "renderWallMs", "peakRssMiB", "renderExitCode", "assessmentReady", "completeSourceCounts"]
        }
        report["variants"][label]["phases"] = progress["phases"]
        report["variants"][label]["errors"] = progress["errors"]
        report["variants"][label]["connectedNativeNetNames"] = connected_names(packet, reference, arguments.cohort)
        report["variants"][label]["coarse"] = [{
            "phase": row["phase"],
            "configured": {key: row.get("configured", {}).get(key) for key in ["MAX_ITERATIONS", "routeCount", "portCount", "regionCount", "initialAssignmentCount", "pathingEffort"]},
            "final": {key: (row.get("final") or {}).get(key) for key in ["iterations", "MAX_ITERATIONS", "currentRoute", "pendingRouteCount", "neverAttemptedCount", "neverSuccessfullyRoutedCount", "bestCompleteSnapshotPresent"]},
        } for row in packet["diagnostics"]["reports"]]
    named_sets = [report["variants"][label]["connectedNativeNetNames"] for label in ["base", "pr"]]
    report["addedPhysicalNets"] = sorted(set(named_sets[1]) - set(named_sets[0])) if all(names is not None for names in named_sets) else None
    report["lostPhysicalNets"] = sorted(set(named_sets[0]) - set(named_sets[1])) if all(names is not None for names in named_sets) else None
    report["attributionQualified"] = parity["matchesAvailablePublishedEvidence"] and all(rows[label]["assessment"] is not None for label in rows)
    output = arguments.root / "pair-summary.json"
    output.write_text(json.dumps(report, indent=2) + "\n")
    print("MATCHED_SOURCE_PAIR " + json.dumps({key: report[key] for key in ["board", "cohort", "addedPhysicalNets", "lostPhysicalNets", "attributionQualified"]}, separators=(",", ":")))
    for label, row in report["variants"].items():
        print("MATCHED_SOURCE_VARIANT " + json.dumps({"lane": label, **{key: value for key, value in row.items() if key != "connectedNativeNetNames"}}, separators=(",", ":")))
    if "GITHUB_STEP_SUMMARY" in os.environ:
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as stream:
            stream.write(f"### {arguments.board} / {arguments.cohort}: matched source pair\n\n")
            stream.write("| Lane | Status | Physical nets | Listed findings | Shared DRC | Complete and clean |\n|---|---|---|---|---|---|\n")
            for label, row in report["variants"].items():
                stream.write(f"| {label} | {row['status']} | {row['connectedNets']}/{row['requestedRoutableNets']} | {row['listedFindingCount']} | {row['sharedDrcErrorCount']} | {row['completeAndClean']} |\n")
            stream.write("\nSource AR packages are explicit overrides; Main/Core remain published. A timeout or partial phase is not completion. Published-control parity and Dataset18 remain separate qualification gates.\n")


if __name__ == "__main__":
    main()
