"""Actual bounded numeric ledgers; initialized, partial and final work stay distinct."""
import math
import re


def integer(value):
    return type(value) is int and value >= 0


def finite(value):
    return type(value) in [int,float] and math.isfinite(value) and value >= 0


def _validate_one_contract(item):
    c = item.get("coverageContract")
    required = {"statsPath","stageName","countFields","timeFields","eligibleField","executedField","positiveSavedFields","savedComparisons","identityEquations","minimumComparisons","maximumFields","eligibleDefinition","executedDefinition","changedDefinition"}
    if not isinstance(c,dict) or set(c) != required:
        raise ValueError("Exact actual-instance numeric coverage contract missing: "+item["id"])
    fields = c["countFields"]+c["timeFields"]
    if not 1 <= len(fields) <= 16 or len(fields) != len(set(fields)):
        raise ValueError("A ledger must expose at most16 unique own scalar fields")
    if c["statsPath"] not in item["evidencePaths"] or not 1 <= len(item["evidencePaths"]) <= 4:
        raise ValueError("The complete actual ledger must fit the frozen observer budget")
    names = [c["eligibleField"],c["executedField"],*c["positiveSavedFields"],*[x for pair in c["savedComparisons"] for x in pair]]
    if not all(name in c["countFields"] for name in names) or any(len(pair)!=2 for pair in c["savedComparisons"]):
        raise ValueError("Mechanism attribution requires typed actual count fields")
    if not all(isinstance(name,str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*",name) for name in fields):
        raise ValueError("Numeric ledger fields must be direct own data")
    if not c["positiveSavedFields"] and not c["savedComparisons"]:
        raise ValueError("An explicit measured saved-work condition is required")
    for equation in c["identityEquations"]:
        if set(equation) != {"left","sum"} or equation["left"] not in c["countFields"] or not all(x in c["countFields"] for x in equation["sum"]):
            raise ValueError("Counter identity refers to missing actual fields")
    for pair in c["minimumComparisons"]:
        if len(pair)!=2 or not all(name in c["countFields"] for name in pair):
            raise ValueError("Counter bound refers to missing actual count fields")
    for field,maximum in c["maximumFields"].items():
        if field not in c["countFields"] or not integer(maximum):
            raise ValueError("Counter hard cap is not a nonnegative integer field")
    if not all(isinstance(c[k],str) and c[k].strip() for k in ["stageName","eligibleDefinition","executedDefinition","changedDefinition"]):
        raise ValueError("Actual stage and count units must be defined")


def _one_coverage(record,item):
    metrics = (record.get("official") or {}).get("routingMetrics")
    raw_audit = metrics.get("experimentAudit") if isinstance(metrics,dict) else None
    audit = raw_audit if isinstance(raw_audit,dict) else {}
    evidence = audit.get("evidence") or {}
    if record.get("arm") == "A":
        return {"status":"BASELINE_DEFAULT_FEATURE_ABSENT","actualEvidence":evidence,"actualWorkExercised":False,"counterCensusFinal":False,"counterEvidenceComplete":False,"activationObserved":False,"optimizationAttributionEligible":False}
    c = item["coverageContract"]
    value = evidence.get(c["statsPath"])
    stats = value if isinstance(value,dict) else {}
    cp = record.get("phaseCheckpointAudit") or {}
    last = cp.get("lastDurableCheckpoint") or {}
    actual_options = last.get("observedRequestedOptions") or record.get("observedRequestedOptions") or {}
    active = actual_options.get(item["option"]) is True and isinstance(value,dict)
    counts_valid = all(integer(stats.get(x)) for x in c["countFields"])
    times_valid = all(finite(stats.get(x)) for x in c["timeFields"])
    exact_population = set(stats) == set(c["countFields"]+c["timeFields"])
    equations = [{"left":q["left"],"leftValue":stats.get(q["left"]),"sum":q["sum"],"sumValue":sum(stats.get(x,0) for x in q["sum"]) if counts_valid else None} for q in c["identityEquations"]]
    bounds = [{"left":left,"leftValue":stats.get(left),"right":right,"rightValue":stats.get(right)} for left,right in c["minimumComparisons"]]
    caps = [{"field":field,"value":stats.get(field),"maximum":maximum} for field,maximum in c["maximumFields"].items()]
    complete = counts_valid and times_valid and exact_population and all(q["leftValue"] == q["sumValue"] for q in equations) and all(q["leftValue"]>=q["rightValue"] for q in bounds) and all(q["value"]<=q["maximum"] for q in caps)
    stage_completed, entered = False, False
    for row in cp.get("stageBoundaries",[]):
        if row.get("phaseName") == c["stageName"]:
            entered = True
            if row.get("event") == "on_solved_exit": stage_completed = True
        elif entered and row.get("event") == "phase_setup_enter":
            # Frozen P9 advances only after the prior active child is solved.
            # Some stages have no onSolved hook, so next-phase setup is the
            # durable completion boundary rather than a nonexistent callback.
            stage_completed = True
    census_final = stage_completed or ((record.get("official") or {}).get("didSolve") is True and last.get("event") == "solve_exit")
    if record.get("forcePartialCensus") is True: census_final = False
    comparisons = [{"leftField":a,"left":stats.get(a),"rightField":b,"right":stats.get(b),"saved":stats[a]-stats[b] if complete else None} for a,b in c["savedComparisons"]]
    saved_positive = complete and (any(stats[x]>0 for x in c["positiveSavedFields"]) or any(q["saved"]>0 for q in comparisons))
    eligible, executed = stats.get(c["eligibleField"]),stats.get(c["executedField"])
    exercised = active and complete and executed > 0
    attributed = exercised and eligible > 0 and saved_positive and census_final
    status = ("ACTUAL_FINAL_CENSUS_WITH_SAVED_WORK" if attributed else "ACTUAL_FINAL_CENSUS_NO_ELIGIBLE_WORK" if active and complete and census_final and eligible==0 else "ACTUAL_FINAL_CENSUS_NO_SAVED_WORK" if active and complete and census_final else "ACTUAL_PARTIAL_CENSUS_LATER_WORK_UNKNOWN" if active and complete else "INVALID_OR_INCOMPLETE_COUNTER_CENSUS" if isinstance(value,dict) else "STAGE_NOT_REACHED_OR_COUNTERS_UNAVAILABLE")
    return {"status":status,"actualEvidence":evidence,"requestedOption":item["option"],"requestedValue":True,
        "stageEvidencePresent":isinstance(value,dict),"actualOwnOptionObserved":actual_options.get(item["option"]),
        "activationObserved":active,"counterEvidenceComplete":complete,"counterCensusFinal":census_final,
        "eligibleWorkCount":eligible,"eligibleWorkDefinition":c["eligibleDefinition"],
        "executedWorkCount":executed,"executedWorkDefinition":c["executedDefinition"],"actualWorkExercised":exercised,
        "positiveSavedCounters":{x:stats.get(x) for x in c["positiveSavedFields"]},"savedComparisons":comparisons,
        "identityEquations":equations,"minimumComparisons":bounds,"maximumFields":caps,"changedWorkDefinition":c["changedDefinition"],
        "optimizationAttributionEligible":attributed,"measuredSlowdownRetainedEvenWithoutSavedWork":True,
        "mechanismWorkIsNotAnOutputOrPerformanceGain":True}


def validate_contract(item):
    extra = item.get("additionalCoverageContracts", [])
    if not isinstance(extra,list) or len(extra)>3:
        raise ValueError("At most four complete observed ledgers are supported")
    contracts = [item.get("coverageContract"),*extra]
    for contract in contracts:
        _validate_one_contract(dict(item,coverageContract=contract))
    paths = [contract["statsPath"] for contract in contracts]
    if len(paths)!=len(set(paths)) or set(paths)!=set(item["evidencePaths"]):
        raise ValueError("Every observed ledger requires one exact independent coverage contract")


def coverage(record,item):
    primary = _one_coverage(record,item)
    extras = item.get("additionalCoverageContracts", [])
    if not extras or record.get("arm")=="A": return primary
    ledgers = [(item["coverageContract"]["statsPath"],primary)]
    for contract in extras:
        ledgers.append((contract["statsPath"],_one_coverage(record,dict(item,coverageContract=contract))))
    primary_status = primary["status"]
    primary_exercised = primary["actualWorkExercised"]
    primary_attributed = primary["optimizationAttributionEligible"]
    # Keep every count and timing unit local to its ledger. Only boolean proof
    # of exercised/saved work is combined; zero handoffs do not erase a valid
    # circuit-context or endpoint-cache mechanism from another complete census.
    attributed_paths = [path for path,value in ledgers if value["optimizationAttributionEligible"]]
    secondary = [{"statsPath":path,**{key:value for key,value in result.items() if key!="actualEvidence"}} for path,result in ledgers[1:]]
    primary.update(primaryLedgerStatus=primary_status,primaryActualWorkExercised=primary_exercised,
                   primaryMechanismAttributionEligible=primary_attributed,
                   additionalMechanismLedgers=secondary,
                   mechanismAttributionEligiblePaths=attributed_paths,
                   primaryLedgerCountAndTimeUnitsRemainSeparate=True,
                   actualWorkExercised=any(value["actualWorkExercised"] for _,value in ledgers),
                   optimizationAttributionEligible=bool(attributed_paths))
    if attributed_paths and not primary_attributed:
        primary["status"]="ACTUAL_FINAL_CENSUS_WITH_ADDITIONAL_LEDGER_SAVED_WORK"
    return primary



def nonterminal_observations(record,item):
    snapshots = []
    progress, cp = record.get("lastObservedEvidence"),record.get("phaseCheckpointAudit") or {}
    last = cp.get("lastDurableCheckpoint") or {}
    if isinstance(progress,dict) and progress.get("inputHash") == record.get("expectedInputHash"):
        snapshots.append(("OFFICIAL_PROGRESS_CALLBACK",progress.get("evidence"),progress.get("phaseName"),progress.get("elapsedTimeMs")))
    if not cp.get("errors") and last.get("inputSha256") == record.get("expectedInputHash") and last.get("algorithmSha") == record.get("sha"):
        snapshots.append(("DURABLE_PHASE_CHECKPOINT",last.get("evidence"),last.get("phaseName"),last.get("officialStartOffsetMs")))
    observations = []
    for source,evidence,phase,elapsed in snapshots:
        if not isinstance(evidence,dict): continue
        temporary = {"arm":record.get("arm"),"official":{"routingMetrics":{"experimentAudit":{"evidence":evidence}}},"phaseCheckpointAudit":cp,"forcePartialCensus":source=="OFFICIAL_PROGRESS_CALLBACK"}
        value = coverage(temporary,item)
        value["mechanismExecutionObserved"] = value["actualWorkExercised"]
        value["completedComponentSavedWorkObserved"] = value["optimizationAttributionEligible"]
        value["optimizationAttributionEligible"] = False
        value.update(source=source,phaseName=phase,observationElapsedMs=elapsed,terminalAudit=False,outputOrTimingCredit=False)
        observations.append(value)
    return observations
