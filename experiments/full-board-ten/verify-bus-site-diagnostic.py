"""Require observational equivalence; diagnostic copper is never board output."""

import json
from pathlib import Path
import sys

output = Path(sys.argv[1])
control = json.loads((output / "control/report.json").read_text())
observed = json.loads((output / "observed/report.json").read_text())
exact_fields = [
    "rawInputSha256", "adaptedInputSha256", "originalEntrySha256",
    "generatedCalls", "pipelines", "firstFallbackReturned",
]
checks = {field: control[field] == observed[field] for field in exact_fields}
for label, report in [("control", control), ("observed", observed)]:
    checks[label + "ExpectedNullFallback"] = (
        len(report["generatedCalls"]) == 1
        and report["generatedCalls"][0]["outcome"]["returned"] is False
    )
    checks[label + "Valid"] = (
        report["firstFallbackReturned"] and not report["captureDeadlineReached"]
        and report["executionError"] is None and not report["observerErrors"]
        and not report["diagnosticMetadata"]["errors"]
        and not report["eventOverflow"] and not report["wasmAttempts"]
        and report["historicalRootAndTrunkMatch"] == [True, True]
        and not report["routingBudgetsChanged"]
    )
proof = {"checks": checks, "acceptedObservation": all(checks.values()),
         "fresh3234FullBoardInputEqualityStillRequired": True,
         "scope": "Exact native child diagnosis, not a new routing-completion result"}
(output / "observation-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
print(json.dumps(proof))
assert all(checks.values()), "Observation changed the captured solve or could not be qualified"
