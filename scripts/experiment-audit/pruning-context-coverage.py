"""Qualify actual pruning context markers without inventing operation savings."""
import copy
import json
import math
import re

PATH = "highDensityRouteSolver.futurePointDistancePruningStats"
STAGE = "highDensityRouteSolver"
OPTION = "experimentFuturePointDistancePruning"
SOLVER = "AutoroutingPipelineSolver9_PreloadedTraceGraph"
FIELDS = ["instances", "contextsPruned"]
SCOPE = ("Only source-admitted internally owned Native contexts with initial future count at least8; "
         "contextsPruned counts contexts with at least one actual skipped Math.sqrt plus numeric addition. "
         "Completed worker batches include work outside the accepted serial prefix.")


def obj(value):
    return value if isinstance(value, dict) else {}


def integer(value):
    return type(value) is int and value >= 0


def finite(value):
    return type(value) in [int, float] and math.isfinite(value) and value >= 0


def same(left, right):
    try:
        return json.dumps(left, sort_keys=True, separators=(",", ":"), allow_nan=False) == json.dumps(right, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError):
        return False


def digest(value, length):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{" + str(length) + "}", value) is not None


def validate_contract(item):
    contract = obj(item.get("coverageContract"))
    expected = {"statsPath": PATH, "stageName": STAGE, "countFields": FIELDS,
                "timeFields": [], "eligibleField": "instances", "executedField": "contextsPruned"}
    if any(not same(contract.get(key), value) for key, value in expected.items()):
        raise ValueError("Pruning requires the exact two-field actual context-marker contract")
    if item.get("option") != OPTION or item.get("evidencePaths") != [PATH] or item.get("additionalCoverageContracts", []) != []:
        raise ValueError("Pruning requires its own exact flag and main-instance evidence path")
    if contract.get("positiveSavedFields", ["contextsPruned"]) != ["contextsPruned"]:
        raise ValueError("Only the actual contextsPruned execution marker is supported")


def checkpoint_bound(record, item):
    """Bind snapshot attribution to a complete, nonmissing actual source identity."""
    cp = obj(record.get("phaseCheckpointAudit"))
    last = obj(cp.get("lastDurableCheckpoint"))
    status = obj(cp.get("status"))
    rows = cp.get("stageBoundaries")
    identities = [("campaign", "campaign"), ("arm", "arm"), ("algorithmSha", "sha"),
                  ("dataset", "dataset"), ("originalSample", "sampleNumber"),
                  ("inputSha256", "expectedInputHash"), ("executionOrder", "executionOrder"),
                  ("githubRunId", "runId"), ("controllerSha", "controllerSha")]
    present = isinstance(record.get("campaign"), str) and bool(record["campaign"].strip())
    present = present and record.get("arm") in ["A", "B"] and digest(record.get("sha"), 40)
    present = present and record.get("dataset") in ["srj18", "srj24"] and integer(record.get("sampleNumber")) and record["sampleNumber"] > 0
    present = present and digest(record.get("expectedInputHash"), 64) and record.get("executionOrder") in ["AB", "BA"]
    present = present and isinstance(record.get("runId"), str) and re.fullmatch(r"[1-9][0-9]*", record["runId"]) is not None and digest(record.get("controllerSha"), 40)
    present = present and isinstance(record.get("requestedOptions"), dict)
    if record.get("arm") == "B":
        present = present and digest(item.get("candidateSha"), 40) and record.get("sha") == item["candidateSha"]
    if not present or cp.get("errors") != [] or not all(same(last.get(key), record.get(field)) for key, field in identities):
        return False
    identity = last.get("observedObjectPath") == "solver" and last.get("observedConstructorName") == SOLVER and last.get("actualCacheProviderState") == "disabled"
    identity = identity and same(last.get("observedRequestedOptions"), record["requestedOptions"])
    status_valid = type(status.get("schemaVersion")) is int and status["schemaVersion"] == 1 and status.get("installed") is True and status.get("solveEntered") is True
    status_valid = status_valid and status.get("errors") == [] and status.get("truncated") is False and type(status.get("solveFinished")) is bool
    status_valid = status_valid and digest(last.get("observerSourceSha256"), 64) and status.get("observerSourceSha256") == last["observerSourceSha256"]
    sequence = isinstance(rows, list) and integer(cp.get("rowCount")) and 3 <= cp["rowCount"] <= 256 and len(rows) == cp["rowCount"]
    sequence = sequence and all(isinstance(row, dict) and type(row.get("sequence")) is int and row["sequence"] == index for index, row in enumerate(rows))
    if not sequence:
        return False
    sequence = [row.get("event") for row in rows[:3]] == ["pipeline_constructor_enter", "pipeline_constructor_exit", "solve_enter"]
    boundary_keys = ["sequence", "event", "phaseName", "officialStartOffsetMs", "solved", "failed"]
    sequence = sequence and same({key: last.get(key) for key in boundary_keys}, rows[-1])
    sequence = sequence and integer(status.get("rowsWritten")) and 3 <= status["rowsWritten"] <= len(rows)
    if status.get("solveFinished") is True:
        sequence = sequence and status["rowsWritten"] == len(rows)
    return bool(identity and status_valid and sequence)


def stage_census(record, bound):
    entered = finished = threw = False
    rows = obj(record.get("phaseCheckpointAudit")).get("stageBoundaries")
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        if row.get("phaseName") == STAGE:
            entered = True
            if row.get("event") in ["phase_failed", "lifecycle_throw", "step_throw"]:
                threw = True
            if row.get("event") == "on_solved_exit" and not threw:
                finished = True
        elif entered and row.get("event") == "phase_setup_enter" and not threw:
            finished = True
    if record.get("forcePartialCensus") is True:
        finished = False
    return entered, bool(bound and finished and not threw)


def coverage(record, item):
    validate_contract(item)
    cp = obj(record.get("phaseCheckpointAudit"));last = obj(cp.get("lastDurableCheckpoint"))
    audit = obj(obj(obj(record.get("official")).get("routingMetrics")).get("experimentAudit"))
    terminal_evidence = obj(audit.get("evidence"));durable_evidence = obj(last.get("evidence"))
    evidence, evidence_source = (terminal_evidence, "TERMINAL_FACTORY_AUDIT") if PATH in terminal_evidence else (durable_evidence, "DURABLE_PHASE_CHECKPOINT")
    value = evidence.get(PATH);stats = obj(value)
    requested = obj(record.get("requestedOptions"));observed_options = obj(last.get("observedRequestedOptions"))
    observed = observed_options.get(OPTION);requested_flag = requested.get(OPTION)
    bound = checkpoint_bound(record, item)
    option_conflict = isinstance(audit.get("options"), dict) and not same(audit["options"], observed_options)
    terminal_identity_conflict = any(key in audit and not same(audit[key], expected) for key, expected in [
        ("inputHash", record.get("expectedInputHash")), ("actualConstructorName", SOLVER),
        ("actualSolverName", SOLVER), ("actualCacheProviderState", "disabled")])
    typed = isinstance(value, dict) and set(value) == set(FIELDS) and all(integer(value[key]) for key in FIELDS)
    complete = typed and stats["contextsPruned"] <= stats["instances"]
    entered, final = stage_census(record, bound)
    observed_true = OPTION in observed_options and observed is True
    active = bound and observed_true and requested_flag is True and isinstance(value, dict) and not option_conflict and not terminal_identity_conflict
    exercised = active and complete and stats["contextsPruned"] > 0
    attributed = exercised and final
    baseline = record.get("arm") == "A"
    default_off = requested_flag is None or requested_flag is False
    absence = value is None and (observed is None or observed is False) and default_off
    if baseline or default_off:
        status = ("BASELINE_DEFAULT_FEATURE_ABSENT" if baseline else "DEFAULT_FALSE_FEATURE_ABSENT") if absence else "DEFAULT_OR_BASELINE_UNEXPECTED_PRUNING_EVIDENCE"
        active = exercised = attributed = final = False
    elif not bound:
        status = "SOURCE_OR_INPUT_UNBOUND"
    elif option_conflict:
        status = "OBSERVED_OPTION_CONFLICT"
    elif terminal_identity_conflict:
        status = "TERMINAL_EVIDENCE_IDENTITY_CONFLICT"
    elif not observed_true or requested_flag is not True:
        status = "OPTION_NOT_OBSERVED_TRUE"
    elif not isinstance(value, dict):
        status = "MISSING_COMPLETE_HD_COUNTER_CENSUS" if final else "STAGE_NOT_REACHED_OR_COUNTERS_UNAVAILABLE"
    elif not complete:
        status = "INVALID_OR_INCOMPLETE_COUNTER_CENSUS"
    elif final:
        status = "ACTUAL_FINAL_HD_CENSUS_WITH_CONTEXT_PRUNING_MARKERS" if exercised else "ACTUAL_FINAL_HD_CENSUS_NO_ADMITTED_CONTEXTS" if stats["instances"] == 0 else "ACTUAL_FINAL_HD_CENSUS_NO_PRUNED_CONTEXT_MARKERS"
    elif not entered:
        status = "INITIALIZED_COUNTERS_HD_NOT_ENTERED"
    else:
        status = "ACTUAL_PARTIAL_CONTEXT_MARKERS_LATER_WORK_UNKNOWN"
    return {"status": status, "workProofKind": "ACTUAL_PRUNING_CONTEXT_MARKERS", "statsPath": PATH,
            "actualEvidence": evidence, "evidenceSource": evidence_source, "sourceBound": bound,
            "requestedOption": OPTION, "requestedValue": requested_flag, "observedOptionValue": observed,
            "actualOwnOptionObserved": observed_true, "observedOptionConflict": option_conflict,
            "terminalEvidenceIdentityConflict": terminal_identity_conflict,
            "activationObserved": bool(active), "stageEvidencePresent": isinstance(value, dict),
            "stageEntered": entered, "counterEvidenceComplete": bool(complete), "counterCensusFinal": bool(final),
            "actualWorkExercised": bool(exercised), "optimizationAttributionEligible": bool(attributed),
            "contextCounts": {key: stats[key] for key in FIELDS} if complete else None,
            "eligibleContextCount": stats.get("instances") if complete else None,
            "contextsWithAtLeastOnePruningSkip": stats.get("contextsPruned") if complete else None,
            "baselineOrDefaultFeatureAbsenceObserved": bool(absence) if baseline or default_off else False,
            "contextMarkerScope": SCOPE, "markerCountsAreNotOperationOrQueryCounts": True,
            "savedOperationCount": None, "additionalSavedScans": "UNKNOWN_CONTEXT_MARKERS_ONLY",
            "savingsProvenByCounters": False, "wholeNearestFunctionCoverageProven": False,
            "optimizationAttributionScope": "Source-bound actual mechanism execution only; quality-qualified paired clocks are separately required for performance evidence.",
            "optimizationTimingCredit": False, "outputOrTimingCredit": False,
            "mechanismWorkIsNotAnOutputOrPerformanceGain": True,
            "measuredSlowdownRetainedEvenWithoutPruningMarkers": True}


def nonterminal_observations(record, item):
    """Preserve bounded prefixes and completed components, never output/timing credit."""
    if record.get("arm") == "A":
        return []
    cp = obj(record.get("phaseCheckpointAudit"));last = obj(cp.get("lastDurableCheckpoint"))
    progress = obj(record.get("lastObservedEvidence"));snapshots = []
    if digest(record.get("expectedInputHash"), 64) and progress.get("inputHash") == record["expectedInputHash"] and progress.get("actualSolverName") == SOLVER and isinstance(progress.get("evidence"), dict) and finite(progress.get("elapsedTimeMs")):
        snapshots.append(("OFFICIAL_PROGRESS_CALLBACK", progress["evidence"], progress.get("phaseName"), progress["elapsedTimeMs"]))
    if isinstance(last.get("evidence"), dict):
        snapshots.append(("DURABLE_PHASE_CHECKPOINT", last["evidence"], last.get("phaseName"), last.get("officialStartOffsetMs")))
    observations = []
    for source, evidence, phase, elapsed in snapshots:
        temporary = copy.deepcopy(record)
        temporary["official"] = {"routingMetrics": {"experimentAudit": {"evidence": evidence}}}
        temporary["forcePartialCensus"] = source == "OFFICIAL_PROGRESS_CALLBACK"
        value = coverage(temporary, item)
        value["mechanismExecutionObserved"] = value["actualWorkExercised"]
        value["completedComponentPruningMarkersObserved"] = value["optimizationAttributionEligible"]
        value["optimizationAttributionEligible"] = False
        value.update(source=source, phaseName=phase, observationElapsedMs=elapsed, terminalAudit=False,
                     outputOrTimingCredit=False, optimizationTimingCredit=False)
        observations.append(value)
    return observations
