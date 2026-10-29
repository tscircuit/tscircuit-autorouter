"""Pure context-marker and source-binding tests; no actual boards or network."""
import copy
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("pruning_context_coverage", ROOT / "pruning-context-coverage.py")
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)

ITEM = {"id": "future-distance-pruning", "option": C.OPTION, "candidateSha": "a" * 40,
        "evidencePaths": [C.PATH], "coverageContract": {"statsPath": C.PATH, "stageName": C.STAGE,
        "countFields": ["instances", "contextsPruned"], "timeFields": [],
        "eligibleField": "instances", "executedField": "contextsPruned", "positiveSavedFields": ["contextsPruned"]}}
CHECKS = []


def check(label, condition):
    assert condition, label
    CHECKS.append(label)


def fixture(*, arm="B", mode="complete", counts=None, flag=True):
    counts = {"instances": 8, "contextsPruned": 5} if counts is None else counts
    options = {"cacheProvider": None, "effort": 1}
    if flag is not None:
        options[C.OPTION] = flag
    source = ITEM["candidateSha"] if arm == "B" else "e" * 40
    record = {"campaign": "pruning-sharded84-20261029:srj18:shard-1:case-14:AB", "arm": arm,
              "sha": source, "dataset": "srj18", "sampleNumber": 14, "expectedInputHash": "b" * 64,
              "executionOrder": "AB", "runId": "999", "controllerSha": "c" * 40,
              "requestedOptions": copy.deepcopy(options)}
    metadata = {"campaign": record["campaign"], "arm": arm, "algorithmSha": source, "dataset": record["dataset"],
                "originalSample": record["sampleNumber"], "inputSha256": record["expectedInputHash"],
                "executionOrder": record["executionOrder"], "githubRunId": record["runId"],
                "controllerSha": record["controllerSha"], "observerSourceSha256": "d" * 64}
    events = [("pipeline_constructor_enter", None, None), ("pipeline_constructor_exit", None, None), ("solve_enter", None, 0)]
    if mode != "initialized":
        events += [("phase_setup_enter", C.STAGE, 5), ("constructor_params_exit", C.STAGE, 6),
                   ("active_subsolver_constructed", C.STAGE, 7), ("phase_run_enter", C.STAGE, 8)]
    if mode in ["complete", "later-timeout", "later-error", "next-phase-only"]:
        if mode != "next-phase-only":
            events += [("on_solved_enter", C.STAGE, 10), ("on_solved_exit", C.STAGE, 11)]
        events += [("phase_setup_enter", "pipeline9JointDrcRepairSolver", 12)]
    if mode == "on-solved-throw":
        events += [("on_solved_enter", C.STAGE, 10), ("lifecycle_throw", C.STAGE, 10.5), ("on_solved_exit", C.STAGE, 11)]
    if mode == "constructor-throw":
        events += [("lifecycle_throw", C.STAGE, 10), ("step_throw", C.STAGE, 11)]
    if mode == "later-error":
        events += [("phase_failed", "pipeline9JointDrcRepairSolver", 14)]
    finished = mode not in ["initialized", "partial", "later-timeout"]
    if finished:
        events += [("solve_exit", None, 15)]
    rows = [{"sequence": i, "event": event, "phaseName": phase, "officialStartOffsetMs": stamp,
             "solved": event == "solve_exit" and mode == "complete", "failed": event == "phase_failed" or (event == "solve_exit" and mode in ["later-error", "constructor-throw", "on-solved-throw"])}
            for i, (event, phase, stamp) in enumerate(events)]
    evidence = {C.PATH: copy.deepcopy(counts)}
    last = {**metadata, **rows[-1], "observedObjectPath": "solver", "observedConstructorName": C.SOLVER,
            "actualCacheProviderState": "disabled", "observedRequestedOptions": copy.deepcopy(options), "evidence": copy.deepcopy(evidence)}
    record["phaseCheckpointAudit"] = {"errors": [], "rowCount": len(rows), "stageBoundaries": rows,
        "lastDurableCheckpoint": last, "status": {"schemaVersion": 1, "observerSourceSha256": "d" * 64,
        "rowsWritten": len(rows) if finished else 3, "installed": True, "solveEntered": True,
        "solveFinished": finished, "errors": [], "truncated": False}}
    record["official"] = {"didSolve": mode == "complete", "didTimeout": mode == "later-timeout",
        "routingMetrics": None if mode == "later-timeout" else {"experimentAudit": {"options": copy.deepcopy(options), "evidence": copy.deepcopy(evidence)}}}
    return record


def cov(record):
    return C.coverage(record, ITEM)


def main():
    valid = fixture();value = cov(valid)
    check("complete-source-bound-final-census", value["sourceBound"] and value["counterCensusFinal"] and value["counterEvidenceComplete"])
    check("actual-context-marker-mechanism", value["actualWorkExercised"] and value["optimizationAttributionEligible"] and value["contextCounts"] == {"instances": 8, "contextsPruned": 5})
    check("no-operation-query-or-speed-credit", value["savedOperationCount"] is None and value["savingsProvenByCounters"] is False and value["optimizationTimingCredit"] is False and value["outputOrTimingCredit"] is False and value["wholeNearestFunctionCoverageProven"] is False)
    check("scope-includes-actual-outside-prefix-batches", "outside the accepted serial prefix" in value["contextMarkerScope"])
    for mode in ["partial", "initialized"]:
        result = cov(fixture(mode=mode, counts={"instances": 0, "contextsPruned": 0}))
        check(mode + "-initialized-zero-not-final", result["counterEvidenceComplete"] and not result["counterCensusFinal"] and not result["actualWorkExercised"])
    partial = cov(fixture(mode="partial"))
    check("partial-positive-marker-real-execution-not-final-attribution", partial["actualWorkExercised"] and not partial["optimizationAttributionEligible"] and not partial["counterCensusFinal"])
    for counts, label in [({"instances": 0, "contextsPruned": 0}, "no-admitted-contexts"), ({"instances": 8, "contextsPruned": 0}, "no-pruned-contexts")]:
        result = cov(fixture(counts=counts))
        check(label + "-valid-final-zero-does-not-create-saving", result["counterEvidenceComplete"] and result["counterCensusFinal"] and not result["optimizationAttributionEligible"])
    for mode in ["later-timeout", "later-error", "next-phase-only"]:
        result = cov(fixture(mode=mode))
        check(mode + "-completed-HD-before-later-outcome", result["counterCensusFinal"] and result["optimizationAttributionEligible"] and not result["optimizationTimingCredit"] and not result["outputOrTimingCredit"])
    for mode in ["constructor-throw", "on-solved-throw"]:
        result = cov(fixture(mode=mode))
        check(mode + "-finally-event-not-completion-proof", not result["counterCensusFinal"] and not result["optimizationAttributionEligible"])
    for counts in [{"instances": True, "contextsPruned": 1}, {"instances": 2, "contextsPruned": False},
                   {"instances": 8.0, "contextsPruned": 2}, {"instances": -1, "contextsPruned": 0},
                   {"instances": 2, "contextsPruned": 3}, {"instances": 2},
                   {"instances": 2, "contextsPruned": 1, "queries": 0}, {}, [], "bad", 1]:
        record = fixture();record["official"]["routingMetrics"]["experimentAudit"]["evidence"][C.PATH] = counts
        result = cov(record)
        check("invalid-counter-" + str(len(CHECKS)), not result["counterEvidenceComplete"] and not result["actualWorkExercised"] and result["contextCounts"] is None)
    missing = fixture();missing["official"]["routingMetrics"]["experimentAudit"]["evidence"][C.PATH] = None
    check("explicit-missing-terminal-ledger-not-hidden-by-old-durable-copy", cov(missing)["status"] == "MISSING_COMPLETE_HD_COUNTER_CENSUS")
    for arm, flag, expected in [("A", None, "BASELINE_DEFAULT_FEATURE_ABSENT"), ("B", False, "DEFAULT_FALSE_FEATURE_ABSENT"), ("B", None, "DEFAULT_FALSE_FEATURE_ABSENT")]:
        result = cov(fixture(arm=arm, flag=flag, counts={}))
        record = fixture(arm=arm, flag=flag);record["official"]["routingMetrics"]["experimentAudit"]["evidence"][C.PATH] = None;record["phaseCheckpointAudit"]["lastDurableCheckpoint"]["evidence"][C.PATH] = None
        result = cov(record)
        check(arm + str(flag) + "-full-inactive-shape", result["status"] == expected and all(result[k] is False for k in ["activationObserved", "actualWorkExercised", "counterCensusFinal", "optimizationAttributionEligible"]) and result["contextCounts"] is None)
    check("baseline-unexpected-own-counter-is-not-mechanism", cov(fixture(arm="A"))["status"] == "DEFAULT_OR_BASELINE_UNEXPECTED_PRUNING_EVIDENCE")
    for flag in [1, "true", [], False, None]:
        result = cov(fixture(flag=flag))
        check("only-own-boolean-true-activates-" + str(flag), not result["activationObserved"] and not result["actualWorkExercised"])
    mismatch = fixture();mismatch["official"]["routingMetrics"]["experimentAudit"]["options"][C.OPTION] = False
    check("terminal-vs-durable-option-conflict", cov(mismatch)["status"] == "OBSERVED_OPTION_CONFLICT" and not cov(mismatch)["actualWorkExercised"])
    for field, bad in [("inputHash", "f" * 64), ("actualSolverName", "OtherSolver"),
                       ("actualConstructorName", "OtherSolver"), ("actualCacheProviderState", "enabled")]:
        mismatch = fixture();mismatch["official"]["routingMetrics"]["experimentAudit"][field] = bad
        check("terminal-evidence-identity-conflict-" + field, cov(mismatch)["status"] == "TERMINAL_EVIDENCE_IDENTITY_CONFLICT" and not cov(mismatch)["actualWorkExercised"])
    identities = [("campaign", "campaign"), ("arm", "arm"), ("sha", "algorithmSha"), ("dataset", "dataset"),
                  ("sampleNumber", "originalSample"), ("expectedInputHash", "inputSha256"),
                  ("executionOrder", "executionOrder"), ("runId", "githubRunId"), ("controllerSha", "controllerSha")]
    for field, observed in identities:
        record = fixture();record.pop(field);record["phaseCheckpointAudit"]["lastDurableCheckpoint"].pop(observed)
        result = cov(record)
        check("missing-on-both-sides-" + field, not result["sourceBound"] and not result["counterCensusFinal"] and not result["actualWorkExercised"])
        record = fixture();record["phaseCheckpointAudit"]["lastDurableCheckpoint"][observed] = "wrong"
        check("foreign-durable-" + field, not cov(record)["sourceBound"])
    foreign = fixture();foreign["sha"] = "f" * 40;foreign["phaseCheckpointAudit"]["lastDurableCheckpoint"]["algorithmSha"] = "f" * 40
    check("foreign-record-and-durable-source-not-matching-candidate", not cov(foreign)["sourceBound"])
    for field, value in [("observedObjectPath", "solver.child"), ("observedConstructorName", "OtherSolver"),
                         ("actualCacheProviderState", "enabled"), ("observedRequestedOptions", {}),
                         ("observerSourceSha256", "f" * 64)]:
        record = fixture();record["phaseCheckpointAudit"]["lastDurableCheckpoint"][field] = value
        check("actual-root-state-" + field, not cov(record)["sourceBound"])
    for field, value in [("installed", False), ("truncated", True), ("errors", ["bad"]),
                         ("schemaVersion", True), ("rowsWritten", True), ("rowsWritten", 999), ("solveEntered", False)]:
        record = fixture();record["phaseCheckpointAudit"]["status"][field] = value
        check("coherent-status-" + field + str(value), not cov(record)["sourceBound"])
    for rows in [None, [], "bad", [{"sequence": 3}]]:
        record = fixture();record["phaseCheckpointAudit"]["stageBoundaries"] = rows
        check("bad-boundary-shape-" + str(rows), not cov(record)["sourceBound"] and not cov(record)["counterCensusFinal"])
    record = fixture();record["phaseCheckpointAudit"]["status"]["rowsWritten"] = 3
    check("finished-status-rowcount-exact", not cov(record)["sourceBound"])
    record = fixture(mode="later-timeout")
    check("unfinished-status-stale3-is-valid", cov(record)["sourceBound"])
    record = fixture();record["forcePartialCensus"] = True
    check("forced-progress-snapshot-cannot-borrow-final-census", not cov(record)["counterCensusFinal"])
    record = fixture(mode="later-timeout")
    record["lastObservedEvidence"] = {"inputHash": record["expectedInputHash"], "actualSolverName": C.SOLVER,
                                      "elapsedTimeMs": 9, "evidence": {C.PATH: {"instances": 2, "contextsPruned": 1}}}
    observations = C.nonterminal_observations(record, ITEM)
    check("two-independent-nonterminal-snapshot-sources", len(observations) == 2)
    progress, durable = observations
    check("progress-positive-markers-stay-partial", progress["mechanismExecutionObserved"] and not progress["counterCensusFinal"] and not progress["optimizationAttributionEligible"])
    check("durable-completed-HD-before-timeout-retained", durable["counterCensusFinal"] and durable["completedComponentPruningMarkersObserved"] and not durable["optimizationAttributionEligible"])
    check("all-nonterminal-output-and-clock-credit-false", all(v["outputOrTimingCredit"] is False and v["optimizationTimingCredit"] is False for v in observations))
    check("baseline-nonterminal-no-invented-work", C.nonterminal_observations(fixture(arm="A", flag=None), ITEM) == [])
    unchanged = fixture();before = copy.deepcopy(unchanged);cov(unchanged);C.nonterminal_observations(unchanged, ITEM)
    check("read-only-record-does-not-change-physical-or-source-facts", unchanged == before)
    malformed = copy.deepcopy(ITEM);malformed["coverageContract"]["countFields"].append("sqrtSkips")
    try:
        C.validate_contract(malformed)
        raise AssertionError("Accepted non-source operation counter")
    except ValueError:
        CHECKS.append("contract-rejects-invented-operation-count")
    print(json.dumps({"status": "PASS_PRUNING_CONTEXT_COVERAGE_INTEGRITY", "checks": len(CHECKS), "labels": CHECKS,
                      "actualBoardRuns": 0, "networkRequests": 0, "operationSavingsClaim": False}))


if __name__ == "__main__":
    main()
