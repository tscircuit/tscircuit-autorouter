"""Synthetic log populations; no solver execution or benchmark measurements."""
import contextlib
import copy
import importlib.util
import io
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("integrity_fixtures", ROOT / "tests/post588-controller-integrity.py")
fixture = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()):
    spec.loader.exec_module(fixture)
runtime, manifest = fixture.m, fixture.manifest
item = manifest["experiments"][0]
spec = importlib.util.spec_from_file_location("population_parser", ROOT / "parse-post588-experiments-log.py")
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)
run_id, controller_sha, dataset, order = "99", "b" * 40, "srj18", "AB"


def make_record(sample, arm, timeout=False):
    value = copy.deepcopy(fixture.record)
    options = manifest["baseline"]["options"] if arm == "A" else item["options"]
    source = runtime.MAIN if arm == "A" else item["candidateSha"]
    input_hash = manifest["expectedInputHashesByDataset"][dataset][str(sample)]
    value.update(campaign=manifest["campaign"] + ":" + item["id"], experiment=item["id"], pr=item["pr"], dataset=dataset,
                 round=1, sampleNumber=sample, arm=arm, executionOrder=order, qualificationMode="full",
                 sha=source, expectedInputHash=input_hash, solverName=runtime.SOLVER, requestedOptions=copy.deepcopy(options))
    row = value["official"]
    row.update(sampleNumber=sample)
    audit = row["routingMetrics"]["experimentAudit"]
    audit.update(inputHash=input_hash, options=copy.deepcopy(options))
    if arm == "A":
        audit["evidence"] = {path: None for path in item["evidencePaths"]}
    value["declaredIntentCopper"]["inputHashes"]["original-input.json"] = input_hash
    cp = {"campaign": value["campaign"], "arm": arm, "algorithmSha": source, "dataset": dataset,
          "originalSample": sample, "inputSha256": input_hash, "executionOrder": order,
          "githubRunId": run_id, "controllerSha": controller_sha,
          "observerSourceSha256": manifest["runtimeSourceHashes"]["phase-checkpoint-observer.ts"],
          "observedObjectPath": "solver", "observedConstructorName": runtime.SOLVER,
          "observedRequestedOptions": copy.deepcopy(options), "actualCacheProviderState": "disabled"}
    events = ["pipeline_constructor_enter", "pipeline_constructor_exit", "solve_enter", "phase_run_enter"]
    if not timeout:
        events.append("solve_exit")
    boundaries = [{"sequence": index, "event": event, "phaseName": "edgeSolver" if index >= 3 else None,
                   "officialStartOffsetMs": None if index < 2 else index * 10,
                   "solved": event == "solve_exit", "failed": False} for index, event in enumerate(events)]
    last = dict(cp, **boundaries[-1], evidence=copy.deepcopy(audit["evidence"]))
    value["phaseCheckpointAudit"] = {"errors": [], "rowCount": len(events), "lastDurableCheckpoint": last,
        "stageBoundaries": boundaries, "status": {"schemaVersion": 1, "observerSourceSha256": cp["observerSourceSha256"],
        "installed": True, "solveEntered": True, "solveFinished": not timeout, "truncated": False, "errors": []}}
    if timeout:
        row.update(didSolve=False, didTimeout=True, relaxedDrcPassed=False, elapsedTimeMs=360000)
        row["routingMetrics"] = {}
        value.update(externalBenchmarkProcessWallMs=360100, supplemental=None, declaredIntentCopper=None)
    runtime.qualify_record(value, manifest, item)
    value["durableTimeoutSourceQualification"] = runtime.timeout_checkpoint_qualification(value)
    value["nonterminalFeatureObservations"] = runtime.coverage_module.nonterminal_observations(value, item)
    return value


def make_log(records):
    lines = []
    for record in records:
        lines.append("POST588_EXPERIMENT_ACTIVE_JSON " + json.dumps({"sampleNumber": record["sampleNumber"], "arm": record["arm"]}))
        lines.append("POST588_EXPERIMENT_RESULT_JSON " + json.dumps(record))
    lines.append("POST588_EXPERIMENT_SUMMARY_JSON " + json.dumps(runtime.summarize(records, dataset, order)))
    result = "\n".join(lines)
    return result


records = [make_record(sample, arm) for sample in range(1, 17) for arm in order]
text = make_log(records)
positive = parser.parse_log(text, runtime, manifest, item, dataset, order, run_id, controller_sha)
assert positive["analysisAuthority"] == "STRICT_ALL_RECORDS", positive["integrityIssues"]
assert len(positive["qualifiedTimingCohort"]) == 16
for invalid in [text + "\nPOST588_EXPERIMENT_RESULT_JSON malformed", text + "\nPOST588_EXPERIMENT_RESULT_JSON " + json.dumps(records[0]), text.replace('"githubRunId": "99"', '"githubRunId": "98"', 1)]:
    result = parser.parse_log(invalid, runtime, manifest, item, dataset, order, run_id, controller_sha)
    assert result["analysisAuthority"] == "UNQUALIFIED_DIAGNOSTIC_ONLY"
    assert result["qualifiedTimingCohort"] == [] and result["qualifiedIdentitySets"] == {}
    assert result["summaryIsDiagnosticOnly"] is True
timeout_records = [make_record(sample, arm, timeout=sample == 1 and arm == "B") for sample in range(1, 17) for arm in order]
result = parser.parse_log(make_log(timeout_records), runtime, manifest, item, dataset, order, run_id, controller_sha)
assert result["analysisAuthority"] == "FULL_POPULATION_WITH_SEPARATELY_PROVEN_TIMEOUTS", result["integrityIssues"]
assert result["strictlyQualified"] is False and result["attemptPopulationSourceQualified"] is True
assert len(result["qualifiedTimingCohort"]) == 15
assert result["records"][1]["strictIntegrityQualified"] is False
assert set(result["records"][1]["strictIntegrityIssues"]) == {"Actual factory input/options/cache identity unproven", "Actual solver/sample/deadline identity differs", "Timing observations missing"}
assert result["summary"]["identitySets"]["completed"]["lost"] == [1]
print(json.dumps({"status": "PASS", "syntheticOnly": True, "positiveFullPopulation": 32,
                  "globalIntegrityForgeriesRejected": 3, "separateTimeoutRetainsThreeOriginalStrictGaps": True,
                  "timeoutExcludedFromTimingPairs": True}))
