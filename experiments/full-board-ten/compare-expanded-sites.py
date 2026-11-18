"""Compare physical completion from a fresh published/Core-Bus-overlay pair."""

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("root", type=Path)
parser.add_argument("board", choices=["glider", "imx6", "icepi", "butterstick"])
parser.add_argument("cohort", choices=["original", "spaced"])
arguments = parser.parse_args()
root, board, cohort = arguments.root.resolve(), arguments.board, arguments.cohort
plan = json.loads(Path(__file__).with_name("expanded-sites-plan.json").read_text())
if plan["qualificationReady"] is not True:
    raise RuntimeError("Expanded-site source and one-span Core mapping are pending; controller held")
selected_cases = [case for case in plan["cases"] if case["board"] == board and case["cohort"] == cohort]
assert len(selected_cases) == 1
expected_nets = selected_cases[0]["expectedRoutableNets"]
changed_declarations = plan["overlay"]["replace"] + plan["overlay"]["insert"]
source_mapping_path = root / "expanded-sites/source-mapping.json"
overlay_proof_path = root / "expanded-sites/overlay-proof.json"
assert hashlib.sha256(source_mapping_path.read_bytes()).hexdigest() == plan["sourceMappingSha256"]
source_mapping = json.loads(source_mapping_path.read_text())
overlay_proof = json.loads(overlay_proof_path.read_text())
assert source_mapping["passed"] is True and source_mapping["schemaVersion"] == 2
assert source_mapping["sourceCandidateCommit"] == plan["source"]["candidateCommit"]
assert source_mapping["externalAliases"] == {"getCopperLayerNames": "getCopperLayerNames3", "distance": "distance16"}
assert plan["overlay"] == {"schemaVersion": 2, "replace": ["expandedSignalSites"], "insert": [], "unchanged": ["routingBounds"]}
assert [row["name"] for row in source_mapping["replacedDeclarations"]] == ["expandedSignalSites"]
assert source_mapping["insertedDeclarations"] == []
assert [row["name"] for row in source_mapping["unchangedDeclarations"]] == ["routingBounds"]
assert source_mapping["sourceFiles"] == plan["source"]["files"]
frozen_packages = {
    "tscircuit": ("0.0.3236", "cfd669f2d96ac77eb054aab53ff34a80120bcd3db72b87f969b3d8b8d2af78a3"),
    "@tscircuit/core": ("0.0.2418", "25f088d42671b5efbf026c70a1216d754c01179e7d767f37e83bef11a0e79fd9"),
    "@tscircuit/eval": ("0.0.1811", "71517bf85bef897c0a658f69fba77e69dc6599f82f701ce966fa6af370991465"),
    "@tscircuit/capacity-autorouter": ("0.0.1129", "76fa23f4776f98870e3d48e0d824fb5737ad3735914d18defe886f318ad172d3"),
}
assert source_mapping["originalCoreSha256"] == frozen_packages["@tscircuit/core"][1]
assert source_mapping["candidateCoreSha256"] != source_mapping["originalCoreSha256"]
rows, manifests, cases = {}, {}, {}
for variant in ["base", "candidate"]:
    lane = root / "lanes" / variant
    directory = lane / "results" / board / cohort
    case = json.loads((lane / "cases" / f"{board}-{cohort}.json").read_text())
    result = json.loads((directory / "result.json").read_text())
    progress = json.loads((directory / "progress.json").read_text())
    assessment = json.loads((directory / "assessment.json").read_text())
    manifest_path = Path(case["runtimeManifestPath"]).resolve()
    assert manifest_path.is_relative_to(root), "Runtime manifest must remain inside this paired run"
    manifest = json.loads(manifest_path.read_text())
    packages = {package["name"]: package for package in manifest["packages"]}
    assert len(packages) == len(manifest["packages"]) == len(frozen_packages)
    assert set(packages) == set(frozen_packages)
    assert manifest["mainVersion"] == "0.0.3236"
    for name, (version, published_sha) in frozen_packages.items():
        expected_sha = source_mapping["candidateCoreSha256"] if variant == "candidate" and name == "@tscircuit/core" else published_sha
        assert packages[name]["version"] == version and packages[name]["entrySha256"] == expected_sha, f"Unexpected selected runtime: {variant} {name}"
    override = manifest.get("routingSourceOverride")
    if variant == "base":
        assert manifest["sourceOverrides"] is False and override is None and manifest["dependencyOverrides"] == []
    else:
        assert manifest["sourceOverrides"] is True and isinstance(override, dict) and override
        assert manifest["dependencyOverrides"] == [override]
        assert override["kind"] == "qualified-embedded-source-overlay" and override["package"] == "@tscircuit/core"
        assert override["embeddedPackage"] == "@tscircuit/bus-lanes-solver" and override["embeddedBaseVersion"] == "0.0.62"
        assert override["autorouterSourceOverride"] is False and override["unchangedRuntimeDependencies"] is True
        assert override["sourceBaseCommit"] == "202b034659fb96bad44d11b8190f4044b675116f"
        assert override["sourceCandidateCommit"] == plan["source"]["candidateCommit"]
        assert override["sourcePatchSha256"] == plan["source"]["patchSha256"]
        assert override["publishedCoreSha256"] == source_mapping["originalCoreSha256"]
        assert override["candidateCoreSha256"] == source_mapping["candidateCoreSha256"]
        assert override["sourceMappingSha256"] == hashlib.sha256(source_mapping_path.read_bytes()).hexdigest()
        assert override["changedDeclarations"] == changed_declarations
    assert case["routingSourceOverride"] == result["routingSourceOverride"] == progress["runtime"]["routingSourceOverride"] == override
    assert result["assessmentReady"] and result["routingPolicyObserved"]
    assert result["auditExitCode"] == 0 and result["auditTimedOut"] is False
    assert result["wasmUsage"]["routingOrUnknownAttempts"] == 0
    assert progress["forbiddenRoutingSolverSelections"] == []
    assert result["completeSourceCounts"] and not assessment["geometryErrors"]
    assert not assessment.get("membershipErrors", [])
    assert result["id"] == case["id"] == board and result["cohort"] == case["cohort"] == cohort
    assert result["executionMode"] == "full" and case["mode"] == "phased" and case["fanout"] is False
    assert case["planes"] == (cohort == "original")
    assert result["memoryCap"] is None
    assert result["captureDeadlineMs"] == case["captureDeadlineMs"] == 900000
    assert result["hardDeadlineMs"] == case["hardDeadlineMs"] == 960000 and case["assessmentDeadlineMs"] == 180000
    requested = assessment["routableNets"] if cohort == "original" else assessment["requestedNets"]
    missing = [net["name"] for net in assessment["missingCopper"]] if cohort == "original" else assessment["unconnectedNets"]
    assert result["requestedRoutableNets"] == requested == case["expectedRoutableNets"] == expected_nets
    assert result["connectedNets"] == assessment["connectedNets"]
    assert len(set(missing)) == len(missing) and assessment["connectedNets"] + len(missing) == requested
    source_bytes = Path(case["sourcePath"]).read_bytes()
    assert hashlib.sha256(source_bytes).hexdigest() == case["sourceSha256"] == progress["sourceSha256"]
    native_source = json.loads(gzip.decompress(source_bytes) if cohort == "spaced" else source_bytes)
    native_names = ({net["nativeName"] for net in native_source["nets"] if net["routable"]}
                    if cohort == "original" else
                    {trace["nativeNet"] for trace in native_source["traces"] if len(trace["path"]) > 1})
    assert len(native_names) == requested and set(missing).issubset(native_names)
    helper = json.loads((root / "cases/assessment-helper-proof.json").read_text())
    assert helper["assessmentOnly"] and helper["rendererNeverImportsThisAdapter"]
    assert helper["coreIdentity"]["entrySha256"] == frozen_packages["@tscircuit/core"][1]
    assert helper["files"] and all(file["prefixExact"] for file in helper["files"])
    circuit_path = directory / "circuit.json.gz"
    circuit_bytes = circuit_path.read_bytes()
    circuit = json.loads(gzip.decompress(circuit_bytes))
    geometry = [element for element in circuit if element["type"] in {"pcb_board", "pcb_component", "pcb_smtpad", "pcb_plated_hole", "pcb_hole"}]
    canonical_geometry = sorted(json.dumps(element, sort_keys=True, separators=(",", ":")) for element in geometry)
    geometry_sha = hashlib.sha256("\n".join(canonical_geometry).encode()).hexdigest()
    manifests[variant], cases[variant] = manifest, case
    rows[variant] = {
        "routingSourceOverride": override,
        "coreEntrySha256": packages["@tscircuit/core"]["entrySha256"],
        "autorouterEntrySha256": packages["@tscircuit/capacity-autorouter"]["entrySha256"],
        "runtimeManifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "sourceSha256": progress["sourceSha256"],
        "implementationFiles": progress["implementationFiles"],
        "assessmentHelper": helper,
        "physicalGeometrySha256": geometry_sha,
        "physicalGeometryElementCount": len(geometry),
        "connectedNets": assessment["connectedNets"],
        "requestedNets": requested,
        "unconnectedNets": missing,
        "completeAndClean": result["completeAndClean"],
        "phasesCompleted": result["phasesCompleted"],
        "renderSettled": result["renderSettled"],
        "hardTimedOut": result["hardTimedOut"],
        "renderWallMs": result["renderWallMs"],
        "lastProgressElapsedMs": progress["elapsedMs"],
        "lastProgressStatus": progress["status"],
        "findings": assessment["findings"],
        "circuitGzipSha256": hashlib.sha256(circuit_bytes).hexdigest(),
        "phasePayloads": [{key: phase[key] for key in ["index", "name", "status", "inputSha256"]} for phase in progress["phases"]],
    }
    del circuit, circuit_bytes, geometry, canonical_geometry

base, candidate = rows["base"], rows["candidate"]
base_manifest, candidate_manifest = manifests["base"], manifests["candidate"]
for field in ["id", "cohort", "mode", "fanout", "planes", "sourcePath", "sourceSha256", "implementationFiles", "expectedComponents", "expectedPads", "expectedNativeNets", "expectedNets", "expectedRoutableNets", "assessmentSourceFiles", "captureDeadlineMs", "hardDeadlineMs", "assessmentDeadlineMs"]:
    assert cases["base"][field] == cases["candidate"][field], f"Native case changed: {field}"
for field in ["sourceSha256", "implementationFiles", "assessmentHelper", "physicalGeometrySha256", "physicalGeometryElementCount"]:
    assert base[field] == candidate[field], f"Native input, assessment or physical geometry changed: {field}"
for field in ["runtimeDependencyFiles", "autorouterDependencyFiles", "runner", "sourceCommits", "additionalChangedPackages"]:
    assert base_manifest[field] == candidate_manifest[field], f"Unrelated runtime changed: {field}"
base_packages = {package["name"]: package for package in base_manifest["packages"] if package["name"] != "@tscircuit/core"}
candidate_packages = {package["name"]: package for package in candidate_manifest["packages"] if package["name"] != "@tscircuit/core"}
assert base_packages == candidate_packages, "Only Core may be overlaid; published autorouter1129 must remain exact"
base_core = next(package for package in base_manifest["packages"] if package["name"] == "@tscircuit/core")
candidate_core = next(package for package in candidate_manifest["packages"] if package["name"] == "@tscircuit/core")
allowed_core_changes = {"entry", "entrySha256", "publishedFiles", "entryProvenance"}
assert {key: value for key, value in base_core.items() if key not in allowed_core_changes} == {key: value for key, value in candidate_core.items() if key not in allowed_core_changes}, "Core package metadata changed beyond the declared entry overlay"
assert candidate_core["entryProvenance"] == "Source overlay; package metadata remains the authenticated published Core metadata"
base_core_files = {file["path"]: file for file in base_core["publishedFiles"]}
candidate_core_files = {file["path"]: file for file in candidate_core["publishedFiles"]}
assert len(base_core_files) == len(base_core["publishedFiles"]) and len(candidate_core_files) == len(candidate_core["publishedFiles"])
assert set(base_core_files) == set(candidate_core_files)
for path, file in base_core_files.items():
    if path == base_core["entryRelative"]:
        assert candidate_core_files[path]["sha256"] == source_mapping["candidateCoreSha256"]
        assert {key: value for key, value in file.items() if key not in {"bytes", "sha256"}} == {key: value for key, value in candidate_core_files[path].items() if key not in {"bytes", "sha256"}}
    else:
        assert file == candidate_core_files[path], f"Unrelated Core file changed: {path}"
base_aliases = {alias["alias"]: alias for alias in base_manifest["packageAliases"] if not alias["alias"].endswith("/@tscircuit/core")}
candidate_aliases = {alias["alias"]: alias for alias in candidate_manifest["packageAliases"] if not alias["alias"].endswith("/@tscircuit/core")}
assert base_aliases == candidate_aliases, "An unrelated runtime package alias changed"
assert overlay_proof["schemaVersion"] == 2
for field in ["onlyReviewedEmbeddedDeclarationsChanged", "allPackageFilesVerified", "unchangedDependencyGraphExceptCoreAlias", "mainAndEvalResolveSelectedCore", "publishedAssessmentHelperPreserved"]:
    assert overlay_proof[field] is True, f"Overlay proof is not qualified: {field}"
assert overlay_proof["sourceMappingSha256"] == hashlib.sha256(source_mapping_path.read_bytes()).hexdigest()
assert overlay_proof["routingSourceOverride"] == candidate["routingSourceOverride"]
assert overlay_proof["publishedCoreSha256"] == source_mapping["originalCoreSha256"]
assert overlay_proof["candidateCoreSha256"] == source_mapping["candidateCoreSha256"]
assert overlay_proof["changedDeclarations"] == changed_declarations
assert overlay_proof["replacedDeclarations"] == plan["overlay"]["replace"]
assert overlay_proof["insertedDeclarations"] == plan["overlay"]["insert"]
assert overlay_proof["publishedManifestSha256"] == base["runtimeManifestSha256"] and overlay_proof["candidateManifestSha256"] == candidate["runtimeManifestSha256"]
restored_path = root / "expanded-sites/assessment-runtime-restored.json"
restored = json.loads(restored_path.read_text())
assert restored["publishedAliasesRestored"] is True and restored["allPublishedFilesVerified"] is True
assert restored["publishedManifestSha256"] == base["runtimeManifestSha256"] and restored["candidateManifestSha256"] == candidate["runtimeManifestSha256"]
assert restored["routingSourceOverride"] is None
assert json.loads((root / "runtime-manifest.json").read_text()) == base_manifest, "Assessment runtime was not restored to the exact published manifest"
assert base["phasePayloads"] and candidate["phasePayloads"], "Fresh native routing must start"
assert base["phasePayloads"][0]["inputSha256"] == candidate["phasePayloads"][0]["inputSha256"], "Initial native routing input changed"
gained = sorted(set(base["unconnectedNets"]) - set(candidate["unconnectedNets"]))
lost = sorted(set(candidate["unconnectedNets"]) - set(base["unconnectedNets"]))
comparison = {
    "scope": "Fresh selected full native circuit, published base then standalone expanded-site bound candidate on the same ARM worker in separate Bun processes. Frozen Main3236/Core2418/Eval1811/AR1129; candidate changes only the AST-qualified Bus62 expandedSignalSites declaration. Native900/960-second render and180-second assessment limits are unchanged. This initial four-case screen is not all-ten coverage.",
    "board": board,
    "cohort": cohort,
    "runId": os.environ.get("GITHUB_RUN_ID"),
    "controllerCommit": os.environ.get("GITHUB_SHA"),
    "sourceMappingSha256": hashlib.sha256(source_mapping_path.read_bytes()).hexdigest(),
    "sourceCandidateCommit": plan["source"]["candidateCommit"],
    "declarationCoverage": plan["overlay"],
    "overlayProofSha256": hashlib.sha256(overlay_proof_path.read_bytes()).hexdigest(),
    "assessmentRestoreProofSha256": hashlib.sha256(restored_path.read_bytes()).hexdigest(),
    "variants": rows,
    "connectedDelta": candidate["connectedNets"] - base["connectedNets"],
    "gainedConnectedNets": gained,
    "lostConnectedNets": lost,
    "completionGainWithoutLostNets": bool(gained) and not lost,
    "physicalGeometryPreserved": True,
    "initialNativeRoutingInputIdentical": True,
    "publishedAssessmentHelperIdentical": True,
    "interpretation": "Only physical assessor connectivity counts as completion. Progress or fanout does not count. A valid paired comparison is not a claim of no regressions or complete/clean routing; partial captures, lost nets and physical findings remain explicit. This is an embedded-source overlay experiment, not a new published package.",
}
(root / "comparison").mkdir(exist_ok=True)
(root / "comparison" / f"{board}-{cohort}.json").write_text(json.dumps(comparison, indent=2) + "\n")
print(json.dumps({key: value for key, value in comparison.items() if key != "variants"}, indent=2))
if "GITHUB_STEP_SUMMARY" in os.environ:
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as summary:
        summary.write(f"### Paired {board} {cohort} physical net completion\n\n")
        summary.write("| Build | Connected/requested | Settled | Hard timeout |\n|---|---|---|---|\n")
        for name, row in rows.items():
            summary.write(f"| {name} | {row['connectedNets']}/{row['requestedNets']} | {row['renderSettled']} | {row['hardTimedOut']} |\n")
        summary.write(f"\nNewly connected: {len(gained)}. Previously connected nets lost: {len(lost)}.\n")
