"""Validate a same-VM full-board pair without counting buffered phase copper."""

import gzip
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
mode = sys.argv[2]
assert mode in ["control", "compare"]
plan = json.loads((Path(__file__).parent / "stitch-candidate-plan.json").read_text())
checks = {}


def check(name, condition):
    checks[name] = bool(condition)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_case(variant):
    directory = root / "results" / variant
    result = json.loads((directory / "result.json").read_text())
    assessment = json.loads((directory / "assessment.json").read_text())
    progress = json.loads((directory / "progress.json").read_text())
    check(f"{variant}_usable_assessment", result["assessmentReady"] and result["completeSourceCounts"] and result["routingPolicyObserved"])
    check(f"{variant}_limits", result["captureDeadlineMs"] == 900000 and result["hardDeadlineMs"] == 960000 and progress["assessmentDeadlineMs"] == 180000)
    check(f"{variant}_source", progress["sourceSha256"] == plan["sourceSha256"] and result["requestedRoutableNets"] == 230)
    check(f"{variant}_phase_input", sha(gzip.decompress((directory / "phase-1-input.srj.json.gz").read_bytes())) == plan["nativeInputSha256"])
    check(f"{variant}_coarse_unchanged", sha((directory / "coarse-diagnostics.json").read_bytes()) == plan["baselineFiles"]["coarse-diagnostics.json"])
    return directory, result, assessment, progress


published_dir, published, published_assessment, published_progress = read_case("published")
check("control_assessment_exact", sha((published_dir / "assessment.json").read_bytes()) == plan["baselineFiles"]["assessment.json"])
check("control_circuit_exact", sha(gzip.decompress((published_dir / "circuit.json.gz").read_bytes())) == plan["baselineCircuitSha256"])
check("control_failure_exact", published["lastError"] == plan["baselineError"] and published["connectedNets"] == 7)
comparison = {"checks": checks, "baselineRun": plan["baselineRun"], "mode": mode}
if mode == "compare":
    candidate_dir, candidate, candidate_assessment, candidate_progress = read_case("candidate")
    source = json.loads((root / "sources/original/experiments/full-board-priority-analysis/icepi/source.json").read_text())
    requested = {net["nativeName"] for net in source["nets"] if net["routable"]}
    assert len(requested) == 230
    connected = {}
    for variant, assessment in [("published", published_assessment), ("candidate", candidate_assessment)]:
        missing = {net["name"] for net in assessment["missingCopper"]}
        check(f"{variant}_native_membership", missing <= requested)
        connected[variant] = requested - missing
        check(f"{variant}_native_count", len(connected[variant]) == assessment["connectedNets"])
    added = sorted(connected["candidate"] - connected["published"])
    lost = sorted(connected["published"] - connected["candidate"])
    published_manifest = json.loads((root / "published-runtime-manifest.json").read_text())
    candidate_manifest = json.loads((root / "runtime-manifest.json").read_text())
    check("runtime_versions_frozen", all(a["name"] == b["name"] and a["version"] == b["version"] for a, b in zip(published_manifest["packages"], candidate_manifest["packages"], strict=True)))
    check("only_autorouter_entry_changed", all(a["entrySha256"] == b["entrySha256"] for a, b in zip(published_manifest["packages"], candidate_manifest["packages"], strict=True) if a["name"] != "@tscircuit/capacity-autorouter"))
    check("exact_candidate_entry", next(p["entrySha256"] for p in candidate_manifest["packages"] if p["name"] == "@tscircuit/capacity-autorouter") == plan["candidateEntrySha256"])
    check("candidate_override_recorded", len(candidate["dependencyOverrides"]) == 1 and candidate["experiment"] == "existing-planar-junctions")
    check("identical_sources_and_dependencies", all(published_manifest[key] == candidate_manifest[key] for key in ["sourceCommits", "runtimeDependencyFiles", "autorouterDependencyFiles"]))
    check("identical_published_assessor", (root / "published-cases/assessment-helper-proof.json").read_bytes() == (root / "candidate-cases/assessment-helper-proof.json").read_bytes())
    check("native_plane_phase_completed", candidate_progress["phases"][0]["name"] == "plane_escape" and candidate_progress["phases"][0]["status"] == "completed")
    check("physical_gain", bool(added) and not lost)
    check("no_new_physical_findings", all(candidate_assessment["findings"][key] <= value for key, value in published_assessment["findings"].items()))
    check("geometry_and_membership_preserved", candidate["geometryErrorCount"] == 0 and candidate["membershipErrorCount"] == 0)
    comparison.update({
        "publishedConnected": published["connectedNets"], "candidateConnected": candidate["connectedNets"],
        "requested": 230, "added": added, "lost": lost,
        "publishedFindings": published_assessment["findings"], "candidateFindings": candidate_assessment["findings"],
        "candidatePhases": [{key: phase[key] for key in ["name", "status", "connections", "terminals"]} for phase in candidate_progress["phases"]],
        "candidateLastError": candidate["lastError"], "candidateCompleteAndClean": candidate["completeAndClean"],
        "timingLimit": "One base-first same-VM pair; no general speed claim.",
    })
comparison["qualified"] = all(checks.values())
(root / "results" / f"{mode}-comparison.json").write_text(json.dumps(comparison, indent=2) + "\n")
print(json.dumps(comparison))
assert comparison["qualified"], [name for name, passed in checks.items() if not passed]
