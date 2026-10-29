"""A source-shaped numeric zero-eligible ledger remains a valid routed record."""
import contextlib
import copy
import importlib.util
import io
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("native_only_fixture", ROOT / "tests/post588-controller-integrity.py")
fixture = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()):
    spec.loader.exec_module(fixture)
definitions = json.loads((ROOT / "post588-feature-contracts.json").read_text())
item = copy.deepcopy(next(item for item in definitions if item["id"] == "incremental-path"))
item["candidateSha"] = fixture.record["sha"]
stats = {"activated": 0, "queryStarts": 12, "repeatedQueries": 0, "eligibleQueries": 0,
         "unsupportedQueries": 12, "budgetDeclinedQueries": 0, "freshSearches": 0, "repairs": 0,
         "changedCostReuseQueries": 0, "changedTransitions": 0, "reusedLabels": 0, "repairedLabels": 0,
         "dependencyVisits": 0, "generatedTransitions": 0, "chargedWork": 0, "solvedQueries": 0}
scope = {"solverInstances": 1, "portCount": 6, "regionCount": 4, "estimatedTransitions": 36,
         "hopVertices": 0, "topologyEligible": 1, "maximumVertices": 32768,
         "maximumTransitions": 65536, "maximumQueries": 32, "prefixDeclinedQueries": 12,
         "arithmeticDeclinedQueries": 0, "changedRepairQueries": 0, "changedRepairReusedLabels": 0,
         "unreachableQueries": 0}
record = copy.deepcopy(fixture.record)
record["requestedOptions"] = copy.deepcopy(item["options"])
audit = record["official"]["routingMetrics"]["experimentAudit"]
audit["options"] = copy.deepcopy(item["options"])
audit["evidence"] = {"portPointPathingSolver.incrementalPath": stats,
                     "portPointPathingSolver.incrementalPathScope": scope}
fixture.m.qualify_record(record, fixture.manifest, item)
assert record["strictIntegrityQualified"] is True, record["strictIntegrityIssues"]
assert fixture.m.physical_clean(record) is True
coverage = record["featureCoverage"]
assert coverage["status"] == "VALID_CENSUS_NO_ELIGIBLE_MECHANISM_WORK"
assert coverage["diagnosticCensusValid"] is True and coverage["observedEntryActivity"] is True
assert coverage["activationObserved"] is False and coverage["actualWorkExercised"] is False
assert coverage["optimizationAttributionEligible"] is False
assert record["official"]["routingMetrics"]["experimentAudit"]["evidence"]["portPointPathingSolver.incrementalPath"]["activated"] == 0
print(json.dumps({"status": "PASS", "syntheticOnly": True, "nativeOnlyCensusValid": True,
                  "numericZeroNeverRewrittenAsActivation": True,
                  "physicalAndSourceQualificationIndependentOfMechanismApplicability": True,
                  "gainAttribution": False}))
