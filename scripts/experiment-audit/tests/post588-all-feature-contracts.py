"""Exercise every new counter contract with synthetic scalar ledgers only."""
import copy
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("all_feature_coverage", ROOT / "post588-coverage.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
definitions = json.loads((ROOT / "post588-feature-contracts.json").read_text())
negative_count = 0
for item in definitions:
    module.validate_contract(item)
    contract = item["coverageContract"]
    stats = {contract["activationField"]: contract["activationValue"], contract["eligibleField"]: 2, contract["executedField"]: 3}
    for field in contract["changedFields"] + contract["positivePrerequisites"]:
        stats[field] = 1
    for field in contract["truePrerequisites"]:
        stats[field] = True
    for left, right in contract["greaterThanFields"]:
        stats[right], stats[left] = 2, 3
    values = [(contract["activationField"], False), (contract["eligibleField"], 0),
              (contract["eligibleField"], True), (contract["executedField"], 0),
              (contract["activationField"], 1 if type(contract["activationValue"]) is bool else True)]
    values += [(field, 0) for field in contract["positivePrerequisites"]]
    values += [(field, False) for field in contract["truePrerequisites"]]
    values += [(left, stats[right]) for left, right in contract["greaterThanFields"]]
    candidates = [stats]
    for field, value in values:
        changed = copy.deepcopy(stats)
        changed[field] = value
        candidates.append(changed)
    changed = copy.deepcopy(stats)
    for field in contract["changedFields"]:
        changed[field] = 0
    candidates.append(changed)
    for index, candidate in enumerate(candidates):
        evidence = {path: candidate if path == contract["statsPath"] else {} for path in item["evidencePaths"]}
        record = {"arm": "B", "official": {"routingMetrics": {"experimentAudit": {"evidence": evidence}}}}
        result = module.coverage(record, item)
        assert result["optimizationAttributionEligible"] is (index == 0), (item["id"], index, result)
        if index:
            negative_count += 1
actual_item = next(item for item in definitions if item["id"] == "incremental-path")
source_fixture = ROOT / "tests/fixtures/incremental-compiled-counter-fixture.json"
import hashlib
assert hashlib.sha256(source_fixture.read_bytes()).hexdigest() == "192484c46eb2a12713f81ab3eaea2951cf15649c4ac61135f0661f0c1ecad7c5"
actual = json.loads(source_fixture.read_text())
for result in actual["results"]:
    evidence = {"portPointPathingSolver.incrementalPath": result["stats"],
                "portPointPathingSolver.incrementalPathScope": result["scope"]}
    record = {"arm": "B", "official": {"routingMetrics": {"experimentAudit": {"evidence": evidence}}}}
    qualified = module.coverage(record, actual_item)
    assert qualified["activationObserved"] is True and qualified["optimizationAttributionEligible"] is True
    assert qualified["changedWorkCounters"] == {"changedCostReuseQueries": 1}
    wrong_contract = copy.deepcopy(actual_item)
    wrong_contract["coverageContract"]["activationValue"] = True
    assert module.coverage(record, wrong_contract)["optimizationAttributionEligible"] is False
    evidence["portPointPathingSolver.incrementalPath"] = dict(result["stats"], changedCostReuseQueries=0)
    assert module.coverage(record, actual_item)["optimizationAttributionEligible"] is False
print(json.dumps({"status": "PASS", "syntheticOnly": True, "positiveFeatureContracts": len(definitions),
                  "negativeCounterControls": negative_count,
                  "requestedFlagsOrInitialCallsNeverSufficeForAttribution": True,
                  "frozenCompiledWorkerNumericActivationFixtures": len(actual["results"]),
                  "numericActivationCannotBeReplacedByBooleanTrue": True}))
