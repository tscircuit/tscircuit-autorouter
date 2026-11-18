#!/usr/bin/env python3
"""Aggregate every isolated case without turning partial proof into a global claim."""
import json
from pathlib import Path
import sys

controller = Path(__file__).resolve().parent
plan = json.loads((controller / "core-reentrancy-plan.json").read_text())
expected = [row["key"] for row in plan["cases"]]
reports = {}
duplicates = []
for path in Path(sys.argv[1]).rglob("native-comparison.json"):
    report = json.loads(path.read_text())
    if report["case"] in reports:
        duplicates.append(report["case"])
    reports[report["case"]] = report
missing = sorted(set(expected) - reports.keys())
unexpected = sorted(reports.keys() - set(expected))
all_present = not missing and not unexpected and not duplicates
summary = {"baselineRun": plan["baselineRun"], "runner": plan["runner"], "caseOrder": expected, "missingCases": missing, "unexpectedCases": unexpected, "duplicateCases": duplicates, "allTenReportsPresent": all_present, "allTenQualified": all_present and all(row["qualified"] for row in reports.values()), "allNativeConnectedNamesPreserved": all_present and all(row.get("nativeConnectivity", {}).get("preserved") is True for row in reports.values()), "baselineConnectedNets": sum(len(row.get("nativeConnectivity", {}).get("baselineConnectedNames", [])) for row in reports.values()), "candidateConnectedNets": sum(len(row.get("nativeConnectivity", {}).get("candidateConnectedNames", [])) for row in reports.values()), "absolutePhysicalAuditCoverageComplete": all_present and all(row.get("absolutePhysicalAuditCoverageComplete") is True for row in reports.values()), "cases": reports, "finalSourceBuildPreviewEquivalence": plan["finalSourceBuildPreviewEquivalence"], "globalClaimPermitted": False, "interpretation": "Inspect native connected-name losses even when accepted SRJ remains unchanged. Every original connected name and pour net/layer group must remain. Mixed-zone absolute audit coverage remains explicit even when exact copper identity proves preservation. Actual source-build/Core-preview equivalence remains required before a PR or global claim."}
Path(sys.argv[2]).write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps({key: summary[key] for key in ["allTenReportsPresent", "allTenQualified", "allNativeConnectedNamesPreserved", "missingCases", "globalClaimPermitted"]}))
raise SystemExit(0 if summary["allTenQualified"] else 1)
