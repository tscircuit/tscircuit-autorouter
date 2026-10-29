"""Source-bound coverage interpretation for the two refinement candidates."""

GLOBAL_DELTA_PATH = "globalDeltaDrcStats"
JOINT_LAYERS_PATH = "effortCleanupSolver.stats.jointLayers"
PATHS = {"delta-drc": [GLOBAL_DELTA_PATH], "joint-layers": [JOINT_LAYERS_PATH]}


def coverage(record, item, original):
    if item["id"] != "delta-drc":
        result = original(record, item)
        if item["id"] == "joint-layers":
            evidence = result.get("actualEvidence", {}).get(JOINT_LAYERS_PATH)
            if isinstance(evidence, dict):
                result["cacheWorkCounters"] = {key: evidence.get(key) for key in [
                    "variantCacheHits", "variantCacheMisses", "pairCacheHits", "pairCacheMisses",
                    "cachedVariantCount", "cachedPairCount", "staticGeometryEvaluations",
                    "staticObstacleBroadphaseRejected", "staticPrimitiveBroadphaseRejected", "staticDistanceEvaluations"]}
                cache = result["cacheWorkCounters"]
                result["cacheCountersComplete"] = all(type(value) is int and value >= 0 for value in cache.values())
                result["cacheReuseObserved"] = result["cacheCountersComplete"] and (
                    cache["variantCacheHits"] > 0 or cache["pairCacheHits"] > 0)
                result["cacheOptimizationAttributionEligible"] = result.get("actualWorkExercised") is True and result["cacheReuseObserved"]
        return result
    audit = (record.get("official") or {}).get("routingMetrics", {}).get("experimentAudit") or {}
    evidence = audit.get("evidence") or {}
    stats = evidence.get(GLOBAL_DELTA_PATH)
    stats = stats if isinstance(stats, dict) else {}
    if record["arm"] == "A":
        return {"status": "BASELINE_DEFAULT_FEATURE_ABSENT", "actualEvidence": evidence,
                "optimizationAttributionEligible": False}
    active = (stats.get("experimentDeltaDrc") is True and
              stats.get("stage") == "globalDrcForceImproveSolver" and
              type(stats.get("nativeConstructorCount")) is int and stats["nativeConstructorCount"] == 1 and
              stats.get("globalDeltaDrcActivated") is True)
    touched, reused, calls = (stats.get(key) for key in [
        "deltaDrcTouchedQueries", "deltaDrcReusedQueries", "deltaDrcCalls"])
    changed_calls, changed_reused = (stats.get(key) for key in [
        "deltaDrcChangedCandidateCalls", "deltaDrcChangedCandidateReusedQueries"])
    complete = all(type(value) is int and value >= 0 for value in [
        touched, reused, calls, changed_calls, changed_reused])
    complete = complete and changed_calls <= calls and changed_reused <= reused
    executed = active and type(calls) is int and calls > 0
    # Repeated identical baseline evaluations can reuse queries without ever
    # exercising a changed overlay. Credit only reuse on actual dynamic edits.
    changed = executed and complete and changed_calls > 0 and changed_reused > 0
    status = ("ACTIVE_WITH_CHANGED_WORK" if changed else
              "ACTIVE_EXECUTED_WITHOUT_ACCEPTED_CHANGE" if executed else
              "ACTIVE_WITHOUT_EXECUTION_PROOF" if active else
              "STAGE_NOT_REACHED_OR_ACTIVATION_UNPROVEN")
    return {"status": status, "actualEvidence": evidence, "requestedOption": item["option"],
            "requestedValue": True, "activationObserved": active,
            "eligibleWorkCount": changed_calls, "executedWorkCount": calls,
            "executedWorkDefinition": "Actual evaluate/evaluateLegacy calls in the native GlobalFI stage; Joint-only evidence is insufficient",
            "actualWorkExercised": executed, "changedWorkCount": changed_reused,
            "totalTouchedQueries": touched, "totalReusedQueries": reused,
            "changedCandidateCalls": changed_calls, "changedCandidateReusedQueries": changed_reused,
            "counterEvidenceComplete": complete, "optimizationAttributionEligible": changed,
            "measuredSlowdownRetainedEvenWithoutAcceptedChange": True,
            "zeroAcceptedChangeIsDiagnosticNotAnOutputGain": True}
