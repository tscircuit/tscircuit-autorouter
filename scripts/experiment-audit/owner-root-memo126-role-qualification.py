"""Native predicate-preserving role-aware provenance qualifier."""
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('fast126_frozen_common',ROOT/'run-bottleneck-experiments.py');common=importlib.util.module_from_spec(s);s.loader.exec_module(common)
s=importlib.util.spec_from_file_location('fast126_role_census',ROOT/'owner-root-memo126-coverage.py');census=importlib.util.module_from_spec(s);s.loader.exec_module(census)
exact,finite,digest=common.exact,common.finite,common.digest
SOLVER,MODULE,CHECKS,declared=common.SOLVER,common.MODULE,common.CHECKS,common.declared
feature_coverage=census.coverage
def qualify_record(record, manifest, item):
    problems = []
    row = record.get("official") or {}
    metrics = row.get("routingMetrics")
    if metrics is not None and not isinstance(metrics, dict):
        problems.append("Official routing metrics are not a nullable object")
    observed_audit = metrics.get("experimentAudit") if isinstance(metrics, dict) else None
    if observed_audit is not None and not isinstance(observed_audit, dict):
        problems.append("Actual factory audit is not an object")
    audit = observed_audit if isinstance(observed_audit, dict) else {}
    options = item["options"]
    if not exact(record.get("requestedOptions"), options):
        problems.append("Record requested options differ from manifest")
    if not audit or audit.get("inputHash") != record["expectedInputHash"] or audit.get("inputMutated") is not False or not exact(audit.get("options"), options) or audit.get("actualCacheProviderState") != "disabled":
        problems.append("Actual factory input/options/cache identity unproven")
    expected_sha = item["candidateSha"]
    if record.get("sha") != expected_sha or audit.get("actualConstructorName") != SOLVER or audit.get("actualSolverName") != SOLVER or audit.get("solverModule") != MODULE or row.get("solverName") != SOLVER or row.get("sampleNumber") != record["sampleNumber"] or row.get("sampleTimeoutMs") != 360000:
        problems.append("Actual solver/sample/deadline identity differs")
    if any(type(row.get(k)) is not bool for k in ["didSolve", "didTimeout", "relaxedDrcPassed"]) or (audit.get("solverSolved") is True and audit.get("solverFailed") is True):
        problems.append("Invalid typed official outcome or contradictory actual state")
    observed = audit.get("evidence") or {}
    baseline_values = list(observed.values())
    if row.get("didSolve") is True and (set(observed) != set(item["evidencePaths"]) or (record["arm"] == "N" and any(value is not None for value in baseline_values))):
        problems.append("Actual terminal experiment evidence path population or native-N feature absence differs")
    if record.get("controllerError") or record.get("supplementalValidationError") or record.get("declaredIntentValidationError"):
        problems.append("Controller or supplemental validation failed")
    actual_runtime = record.get("officialReportRuntime") or {}
    if any(type(actual_runtime.get(k)) is not int or actual_runtime[k] != 1 for k in ["threadsPerSample", "effectiveThreadsPerSample", "cpuBudgetPerSample", "requestedConcurrency", "workerCount"]) or actual_runtime.get("bunVersion") != "1.4.2":
        problems.append("Actual official Bun/thread/concurrency runtime differs from the fixed protocol")
    if not all(finite(v) for v in [row.get("elapsedTimeMs"), audit.get("constructorTimeMs"), record.get("externalBenchmarkProcessWallMs")]):
        problems.append("Timing observations missing")
    elif record["externalBenchmarkProcessWallMs"] + .001 < row["elapsedTimeMs"] + audit["constructorTimeMs"]:
        problems.append("External wall shorter than primary clocks")
    if row.get("didSolve") is True:
        supplemental = record.get("supplemental") or {}
        if audit.get("solverSolved") is not True or audit.get("solverFailed") is not False or audit.get("solverError") is not None or row.get("didTimeout") is not False:
            problems.append("Solved result contradicts actual terminal state")
        if not all(digest(audit.get(k), 64) for k in ["rawOutputHash", "rawNewTracesHash"]) or not digest(supplemental.get("canonicalCircuitJsonSha256"), 64):
            problems.append("Solved result missing actual output/canonical copper hashes")
        for name in CHECKS:
            check = supplemental.get(name, {})
            if type(check.get("count")) is not int or check["count"] < 0 or not isinstance(check.get("byType"), dict) or any(type(v) is not int or v < 0 for v in check.get("byType", {}).values()) or sum(check.get("byType", {}).values()) != check.get("count"):
                problems.append("Supplemental findings population invalid: " + name)
        problems.extend(declared.validate_compact(record, manifest))
        copper = supplemental.get("physicalCopper") or {}
        if any(type(copper.get(k)) is not int or copper[k] < 0 for k in ["combinedRouteViaCount", "uniqueOwnedViaSiteSpanCount", "uniqueOwnedManufacturedViaSiteCount", "foreignOwnerCoincidentViaSiteSpans", "combinedRoutePointCount"]) or any(not finite(copper.get(k)) for k in ["combinedCopperLength", "exactSegmentDeduplicatedCopperLength"]):
            problems.append("Physical copper counts/lengths are not finite typed nonnegative metrics")
    if record.get("phaseCheckpointAudit", {}).get("errors"):
        problems.extend(record["phaseCheckpointAudit"]["errors"])
    record["featureCoverage"] = feature_coverage(record, item)
    record["strictIntegrityIssues"] = problems
    record["strictIntegrityQualified"] = not problems
    return record
