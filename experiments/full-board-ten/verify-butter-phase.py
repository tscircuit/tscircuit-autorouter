#!/usr/bin/env python3
"""Require exact Butter control parity and actual candidate phase completion."""

import gzip
import hashlib
import json
from pathlib import Path
import runpy
import sys


def main() -> None:
    root, lane = Path(sys.argv[1]), sys.argv[2]
    if lane not in ["base", "candidate"]:
        raise RuntimeError("Expected base or candidate")
    controller = Path(__file__).resolve().parent
    plan = json.loads((controller / "butter-phase-plan.json").read_text())
    normalize = runpy.run_path(str(controller / "verify-tiny-source-phase.py"))["normalize_class_name"]
    folder = root / "native-phase" / lane
    result = json.loads((folder / "result.json").read_text())
    reports = json.loads((folder / "coarse-diagnostics.json").read_text())["reports"]
    if len(reports) != 1:
        raise RuntimeError("Expected one actual plane-escape report")
    coarse = reports[0]
    configured = coarse["configured"]
    checks = {
        "same_native_input": result["inputSha256"] == plan["inputSha256"],
        "same_compiled_entry": result["selectedAutorouterSha256"] == plan["sourceEntries"][lane]["index.js"],
        "same_phase": result["targetPhase"] == coarse["phase"] == "plane_escape",
        "same_limits": result["captureDeadlineMs"] == 900000 and result["hardDeadlineMs"] == 960000,
        "finished_native_execution": result["timedOut"] is False and result["thrownError"] is None,
        "no_routing_wasm": result["wasmUsage"]["routingOrUnknownAttempts"] == 0,
        "coarse_hook_from_start": coarse["innerHookInstalled"] is True and configured["hookInstalledAtIteration"] == 0,
        "same_native_graph": all(configured[key] == value for key, value in plan["nativeShape"].items()),
        "same_native_budget": configured["MAX_ITERATIONS"] == 4000000,
        "no_glider_path_witness": not (folder / "path-witness.json").exists(),
    }
    normalization = None
    if lane == "base":
        baseline = json.loads((root / "native-input/coarse-diagnostics.json").read_text())["reports"][0]
        expected, expected_edits = normalize(baseline)
        actual, actual_edits = normalize(coarse)
        checks["same_complete_coarse_report"] = actual == expected
        checks["same_limit_failure"] = result["failed"] is True and result["solved"] is False and result["outputSummary"] is None and coarse["final"]["failed"] is True and coarse["final"]["iterations"] == 4000000 and result["error"] == f"{configured['className']} ran out of iterations" and coarse["final"]["error"] == result["error"]
        normalization = {"published": expected_edits, "source": actual_edits, "onlyConstructorNamesChanged": True}
    else:
        base_validation = json.loads((root / "native-phase/base/validation.json").read_text())
        checks["source_control_qualified"] = base_validation["valid"] is True
        checks["entire_native_phase_solved"] = coarse["final"]["solved"] is True and coarse["final"]["failed"] is False and result["solved"] is True and result["failed"] is False and result["error"] is None and result["outputSummary"] is not None
        output_path = folder / "phase-output.srj.json.gz"
        checks["actual_phase_output_retained"] = result["outputSummary"] is not None and output_path.is_file() and hashlib.sha256(gzip.decompress(output_path.read_bytes())).hexdigest() == result["outputSummary"]["sha256"]
    validation = {"lane": lane, "valid": all(checks.values()), "checks": checks, "constructorNormalization": normalization, "interpretation": "Whole native phase qualification only; no full-board physical completion claim."}
    (folder / "validation.json").write_text(json.dumps(validation, indent=2) + "\n")
    print(json.dumps(validation, indent=2))
    if not validation["valid"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
