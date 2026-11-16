#!/usr/bin/env python3
"""Expose compact benchmark results through normal Actions reporting."""

import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1])
board = sys.argv[2]
records = []
cohorts = os.environ.get("FULL_BOARD_COHORTS", "original,spaced").split(",")
if cohorts not in [["original", "spaced"], ["spaced"]]:
    raise RuntimeError("Unexpected benchmark cohort selection")
experiment = os.environ.get("FULL_BOARD_EXPERIMENT", "published")
for cohort in cohorts:
    path = root / "results" / board / cohort / "result.json"
    if path.exists():
        result = json.loads(path.read_text())
        record = {key: result[key] for key in [
            "id", "cohort", "status", "completeAndClean", "renderExitCode",
            "hardTimedOut", "renderWallMs", "peakRssMiB", "auditExitCode",
            "auditTimedOut", "assessmentReady", "renderSettled", "phasesCompleted",
            "completeSourceCounts", "requestedRoutableNets", "connectedNets",
            "geometryErrorCount", "membershipErrorCount", "listedFindingCount",
            "sharedDrcErrorCount", "routingPolicyObserved",
            "captureDeadlineMs", "hardDeadlineMs", "assessmentDeadlineMs",
            "diagnosticOnly", "routingSourceOverride", "longWindowDiagnostic",
        ]}
        record["vias"] = result["emittedCounts"]["pcb_via"] if result["emittedCounts"] is not None else None
    else:
        record = {"id": board, "cohort": cohort, "status": "missing_result", "completeAndClean": False}
    progress_path = path.parent / "progress.json"
    if progress_path.exists():
        progress = json.loads(progress_path.read_text())
        phases = progress["phases"]
        current = next((phase for phase in reversed(phases) if phase["status"] == "running"), None)
        last = phases[-1] if phases else None
        for key, phase in [("currentPhase", current), ("lastPhase", last)]:
            record[key] = {name: phase[name] for name in ["name", "status", "index", "connections", "elapsedMs"] if name in phase} if phase else None
        record["phases"] = [{
            **{name: phase[name] for name in ["name", "status", "connections", "solver"] if name in phase},
            "elapsedMs": phase["elapsedMs"] if "elapsedMs" in phase else progress["elapsedMs"] - phase["startedMs"],
        } for phase in phases]
        record["firstError"] = str(progress["errors"][0])[:300] if progress["errors"] else None
        record["lastError"] = str(progress["errors"][-1])[:300] if progress["errors"] else None
        failed_solver = next((solver for solver in progress["solvers"] if solver.get("error")), None)
        record["firstSolverError"] = {"name": failed_solver["name"], "error": str(failed_solver["error"])[:300]} if failed_solver else None
    records.append(record)
    message = json.dumps(record, separators=(",", ":"))
    escaped = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"FULL_BOARD_RESULT {message}")
    print(f"::notice title=Full-board {board} {cohort}::{escaped}")
summary = {"board": board, "experiment": experiment, "cases": records, "allClean": all(record["completeAndClean"] for record in records)}
destination = root / "results" / board
destination.mkdir(parents=True, exist_ok=True)
(destination / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
    output.write("all_clean=" + str(summary["allClean"]).lower() + "\n")
with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as output:
    output.write(f"### {board}: {experiment} full-board cases\n\n")
    output.write("| Cohort | Status | Connected/requested | Listed findings | Shared DRC | Last phase | Capture/hard/audit seconds |\n|---|---|---|---|---|---|---|\n")
    for record in records:
        phase = record.get("lastPhase")
        phase_name = phase["name"] if phase else "unavailable"
        window_values = [record.get(key) for key in ["captureDeadlineMs", "hardDeadlineMs", "assessmentDeadlineMs"]]
        window = " / ".join(
            str(value / 1000)
            if isinstance(value, (int, float)) and not isinstance(value, bool)
            else "unavailable"
            for value in window_values
        )
        output.write(f"| {record['cohort']} | {record['status']} | {record.get('connectedNets')}/{record.get('requestedRoutableNets')} | {record.get('listedFindingCount')} | {record.get('sharedDrcErrorCount')} | {phase_name} | {window} |\n")
    output.write("\nTimeouts, missing assessments and incomplete nets remain explicit failures.\n")
