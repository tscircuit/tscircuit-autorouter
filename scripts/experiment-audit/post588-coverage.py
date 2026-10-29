"""Qualify new mechanisms from bounded scalar data on their actual instances."""
import math
import re


def integer(value):
    """Instrumentation counts are nonnegative integers, never booleans."""
    valid_type = type(value) is int
    if not valid_type:
        return False
    finite_value = math.isfinite(value)
    return finite_value and value >= 0


def validate_contract(item):
    contract = item.get("coverageContract")
    if not isinstance(contract, dict):
        raise ValueError("Missing actual-instance coverage contract: " + item["id"])
    required = {"statsPath", "activationField", "activationValue", "eligibleField", "executedField", "changedFields", "positivePrerequisites", "truePrerequisites", "greaterThanFields", "eligibleDefinition", "executedDefinition", "changedDefinition"}
    if set(contract) != required:
        raise ValueError("Coverage contract fields differ: " + item["id"])
    if contract["statsPath"] not in item.get("evidencePaths", []):
        raise ValueError("Coverage stats are not an observed evidence path")
    names = [contract[key] for key in ["activationField", "eligibleField", "executedField"]]
    names += contract["changedFields"] + contract["positivePrerequisites"] + contract["truePrerequisites"]
    if not isinstance(contract["greaterThanFields"], list) or len(contract["greaterThanFields"]) > 4 or any(not isinstance(pair, list) or len(pair) != 2 for pair in contract["greaterThanFields"]):
        raise ValueError("Bounded field comparisons are required")
    names += [name for pair in contract["greaterThanFields"] for name in pair]
    if not all(isinstance(name, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) for name in names):
        raise ValueError("Coverage fields must be direct scalar data properties")
    if not contract["changedFields"] or len(contract["changedFields"]) > 4 or len(contract["positivePrerequisites"]) > 4 or len(contract["truePrerequisites"]) > 4:
        raise ValueError("Coverage condition budget differs")
    if type(contract["activationValue"]) not in [bool, int] or contract["activationValue"] not in [True, 1]:
        raise ValueError("Activation requires an explicit true/one value")
    if any(not isinstance(contract[key], str) or not contract[key].strip() for key in ["eligibleDefinition", "executedDefinition", "changedDefinition"]):
        raise ValueError("Actual-work definitions are required")


def coverage(record, item):
    audit = (record.get("official") or {}).get("routingMetrics", {}).get("experimentAudit") or {}
    evidence = audit.get("evidence") or {}
    if record.get("arm") == "A":
        return {"status": "BASELINE_DEFAULT_FEATURE_ABSENT", "actualEvidence": evidence,
                "optimizationAttributionEligible": False}
    contract = item["coverageContract"]
    value = evidence.get(contract["statsPath"])
    stats = value if isinstance(value, dict) else {}
    activation = stats.get(contract["activationField"])
    expected = contract["activationValue"]
    active = type(activation) is type(expected) and activation == expected
    eligible = stats.get(contract["eligibleField"])
    executed = stats.get(contract["executedField"])
    changed = {field: stats.get(field) for field in contract["changedFields"]}
    prerequisites = {field: stats.get(field) for field in contract["positivePrerequisites"]}
    true_prerequisites = {field: stats.get(field) for field in contract["truePrerequisites"]}
    comparisons = [{"leftField": left, "left": stats.get(left), "rightField": right, "right": stats.get(right)} for left, right in contract["greaterThanFields"]]
    complete = all(integer(item) for item in [eligible, executed, *changed.values(), *prerequisites.values(), *[value for pair in comparisons for value in [pair["left"], pair["right"]]]]) and all(type(item) is bool for item in true_prerequisites.values())
    exercised = active and integer(executed) and executed > 0
    changed_work = complete and any(item > 0 for item in changed.values()) and all(item > 0 for item in prerequisites.values()) and all(pair["left"] > pair["right"] for pair in comparisons) and all(item is True for item in true_prerequisites.values())
    attributed = exercised and complete and eligible > 0 and changed_work
    status = "ACTIVE_WITH_MECHANISM_WORK" if attributed else "ACTIVE_EXECUTED_WITHOUT_CHANGED_WORK" if exercised else "ACTIVE_WITHOUT_EXECUTION_PROOF" if active else "STAGE_NOT_REACHED_OR_ACTIVATION_UNPROVEN"
    return {"status": status, "actualEvidence": evidence, "requestedOption": item["option"],
            "requestedValue": True, "stageEvidencePresent": isinstance(value, dict),
            "activationObserved": active, "eligibleWorkCount": eligible,
            "eligibleWorkDefinition": contract["eligibleDefinition"],
            "executedWorkCount": executed, "executedWorkDefinition": contract["executedDefinition"],
            "actualWorkExercised": exercised, "changedWorkCounters": changed,
            "changedWorkDefinition": contract["changedDefinition"],
            "positivePrerequisiteCounters": prerequisites, "truePrerequisiteCounters": true_prerequisites, "greaterThanComparisons": comparisons, "counterEvidenceComplete": complete,
            "optimizationAttributionEligible": attributed,
            "measuredSlowdownRetainedEvenWithoutChangedWork": True,
            "mechanismWorkIsNotAnOutputOrPerformanceGain": True}


def nonterminal_observations(record, item):
    snapshots = []
    progress = record.get("lastObservedEvidence")
    checkpoint = record.get("phaseCheckpointAudit") or {}
    last = checkpoint.get("lastDurableCheckpoint") or {}
    if isinstance(progress, dict) and progress.get("inputHash") == record.get("expectedInputHash"):
        snapshots.append(("OFFICIAL_PROGRESS_CALLBACK", progress.get("evidence"), progress.get("phaseName"), progress.get("elapsedTimeMs")))
    if not checkpoint.get("errors") and last.get("inputSha256") == record.get("expectedInputHash") and last.get("algorithmSha") == record.get("sha"):
        snapshots.append(("DURABLE_PHASE_CHECKPOINT", last.get("evidence"), last.get("phaseName"), last.get("officialStartOffsetMs")))
    observations = []
    for source, evidence, phase, elapsed in snapshots:
        if not isinstance(evidence, dict):
            continue
        temporary = {"arm": record.get("arm"), "official": {"routingMetrics": {"experimentAudit": {"evidence": evidence}}}}
        value = coverage(temporary, item)
        value["mechanismExecutionObserved"] = value["optimizationAttributionEligible"]
        value["optimizationAttributionEligible"] = False
        value.update(source=source, phaseName=phase, observationElapsedMs=elapsed,
                     terminalAudit=False, outputOrTimingCredit=False)
        observations.append(value)
    return observations
