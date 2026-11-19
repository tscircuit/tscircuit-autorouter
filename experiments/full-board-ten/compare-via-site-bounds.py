"""Offline remaining-nine native comparison; reads retained ZIPs, never routes or downloads.

Usage: python3 compare-via-site-bounds.py REQUEST.json
The request supplies candidateRunId, candidateHead, baselineHandoffPath, baselineHandoffSha256,
outputPath, and nine bounds-fix cases excluding H616 spaced. Each case has board, cohort, nativeSourcePath,
baselineCaseProof, baselineSummaryProof, candidateCase and candidateSummary.
Candidate archive references contain archivePath and metadataPath.
"""

from collections import Counter
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import zipfile


CONTROL_RUN = 44471059539
CONTROL_HEAD = "14176a107694e38d70afc7e6653cf4bb6755e869"
CONTROL_CONTROLLER_HANDOFF_SHA = "6fcf5354b6e8e0d91ff9fa9f35d608802d51e99ca4f2c615d7c22e2b04692a49"
COUNTS = {"h616": 121, "butterstick": 317, "glider": 356, "imx6": 404, "icepi": 230}
GEOMETRY_TYPES = {"pcb_board", "pcb_component", "pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_port"}
PHYSICAL_GROUPS = {
    "overlap": "trace_overlap", "padTrace": "pad_trace", "viaTrace": "via_trace",
    "viaPad": "via_pad", "viaSpacing": "via_spacing", "contiguous": "contiguous",
    "viaInPad": "via_in_pad", "holeTrace": "hole_trace",
}
MEMBER_LIMIT = 256 * 1024 * 1024
CONTROLLER = Path(__file__).resolve().parent


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_bytes())


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


class Archive:
    def __init__(self, reference, expected):
        reference = read_json(reference) if isinstance(reference, str) else reference
        self.metadata = reference.get("artifact") or read_json(reference["metadataPath"])
        metadata = self.metadata
        assert metadata["workflow_run"]["id"] == expected["run"]
        assert metadata["workflow_run"]["head_sha"] == expected["head"]
        assert re.fullmatch(re.escape(expected["name"]) + r"-[1-9]\d*", metadata["name"])
        self.path = Path(reference["archivePath"])
        assert self.path.stat().st_size == metadata["size_in_bytes"]
        with self.path.open("rb") as stream:
            self.sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
        assert metadata["digest"] == "sha256:" + self.sha256
        if expected.get("control") is not None:
            retained = expected["control"][metadata["id"]]
            assert retained["sha256"] == self.sha256 and retained["bytes"] == metadata["size_in_bytes"]
            assert retained["name"] == metadata["name"]
        self.zip = zipfile.ZipFile(self.path)
        names = self.zip.namelist()
        assert len(names) == len(set(names))
        assert all(not Path(name).is_absolute() and ".." not in Path(name).parts for name in names)

    def data(self, name):
        assert self.zip.getinfo(name).file_size <= MEMBER_LIMIT
        return self.zip.read(name)

    def json(self, name):
        return json.loads(self.data(name))

    def gz_json(self, name):
        with gzip.GzipFile(fileobj=io.BytesIO(self.data(name))) as stream:
            raw = stream.read(MEMBER_LIMIT + 1)
        assert len(raw) <= MEMBER_LIMIT
        return json.loads(raw), digest(raw)


def package_identity(manifest):
    return {row["name"]: {key: row[key] for key in ["version", "entryRelative", "entrySha256", "publishedFiles"]}
            for row in manifest["packages"]}


def verify_runtime(manifest, expected):
    release, autorouter_sha, baseline, entry_delta = expected
    assert manifest["mainVersion"] == release["mainVersion"] == "0.0.3243"
    packages = {row["name"]: row for row in manifest["packages"]}
    assert len(packages) == len(manifest["packages"]) == 4
    for row in release["packages"]:
        actual = packages[row["name"]]
        expected_sha = autorouter_sha if row["name"] == "@tscircuit/capacity-autorouter" else row["entrySha256"]
        assert actual["version"] == row["version"] and actual["entrySha256"] == expected_sha
        baseline_package = next(item for item in baseline["packages"] if item["name"] == row["name"])
        assert actual["entryRelative"] == row["entryRelative"]
        expected_files = {item["path"]: item for item in baseline_package["publishedFiles"]}
        assert len(expected_files) == len(baseline_package["publishedFiles"])
        actual_files = {item["path"]: item for item in actual["publishedFiles"]}
        assert len(actual_files) == len(actual["publishedFiles"]) and actual_files.keys() == expected_files.keys()
        for path, item in actual_files.items():
            if row["name"] == "@tscircuit/capacity-autorouter" and path == row["entryRelative"]:
                assert item["sha256"] == expected_sha
                assert item["bytes"] == expected_files[path]["bytes"] + entry_delta
            else:
                assert item == expected_files[path]
    for field in ["additionalChangedPackages", "sourceCommits"]:
        assert manifest[field] == baseline[field]
    runner = manifest["runner"]
    assert runner["architecture"] in ["arm64", "aarch64"] and runner["cpuCount"] == 8
    assert runner["bun"] == "1.4.3" and runner["artificialMemoryLimitApplied"] is False
    for field, directory in [("runtimeDependencyFiles", "runtime"), ("autorouterDependencyFiles", "autorouter-dependencies")]:
        assert manifest[field] == {
            "packageSha256": digest((CONTROLLER / directory / "package.json").read_bytes()),
            "lockSha256": digest((CONTROLLER / directory / "bun.lock").read_bytes()),
        }


def verify_published(manifest):
    assert manifest["experiment"] == "published" and manifest["sourceOverrides"] is False
    assert manifest["dependencyOverrides"] == [] and manifest.get("routingSourceOverride") is None


def native_source(spec, provenance):
    board, cohort = spec["board"], spec["cohort"]
    relative = f"experiments/full-board-priority-analysis/{board}/source.json" if cohort == "original" else f"full-boards/{board}.json.gz"
    expected = next(row for row in provenance[cohort]["files"] if row["path"] == relative)
    data = Path(spec["nativeSourcePath"]).read_bytes()
    assert digest(data) == expected["sha256"]
    source = json.loads(gzip.decompress(data) if cohort == "spaced" else data)
    names = ({row["nativeName"] for row in source["nets"] if row["routable"]} if cohort == "original"
             else {row["nativeNet"] for row in source["traces"] if len(row["path"]) > 1})
    assert len(names) == COUNTS[board]
    return {"names": names, "sha256": expected["sha256"]}


def verify_assessment_helper(helper, expected):
    assert helper["assessmentOnly"] is True and helper["rendererNeverImportsThisAdapter"] is True
    core = next(row for row in expected["packages"] if row["name"] == "@tscircuit/core")
    assert helper["coreIdentity"]["entrySha256"] == core["entrySha256"]
    assert helper["files"] and all(row["prefixExact"] is True for row in helper["files"])
    assert len({row["name"] for row in helper["files"]}) == len(helper["files"])
    return {"coreSha256": core["entrySha256"], "files": sorted(helper["files"], key=lambda row: row["name"])}


def verify_candidate_proofs(archive, context):
    plan, mapping = context["plan"], context["mapping"]
    for name in ["via-site-bounds-plan.json", plan["sourceMappingFile"], plan["pairedByteProofFile"], "release.json",
                 "source-provenance.json", "harness-provenance.json", "baseline-run-plan.json", "published-baseline-controller-handoff.json"]:
        assert archive.data("via-site-bounds/controller/" + name) == (CONTROLLER / name).read_bytes()
    published_bytes = archive.data("published-runtime-manifest.json")
    candidate_bytes = archive.data("candidate-runtime-manifest.json")
    published, candidate = json.loads(published_bytes), json.loads(candidate_bytes)
    assert archive.data("runtime-manifest.json") == published_bytes
    assert archive.data("via-site-bounds/source-mapping.json") == context["mappingBytes"]
    override = candidate["routingSourceOverride"]
    source = plan["source"]
    expected_override = {
        "kind": "qualified-source-overlay", "package": "@tscircuit/capacity-autorouter", "source": mapping["source"],
        "publishedAutorouterSha256": mapping["originalAutorouterSha256"], "candidateAutorouterSha256": mapping["candidateAutorouterSha256"],
        "publishedCoreSha256": plan["runtime"]["publishedCoreSha256"],
        "changedDeclarations": plan["overlay"]["replace"] + plan["overlay"]["insert"],
        "sourceMappingSha256": digest(context["mappingBytes"]), "autorouterSourceOverride": True,
        "coreSourceOverride": False, "unchangedRuntimeDependencies": True,
    }
    assert override == expected_override
    assert candidate["experiment"] == plan["experiment"] and candidate["sourceOverrides"] is True
    assert candidate["dependencyOverrides"] == [override]
    proof = archive.json("via-site-bounds/overlay-proof.json")
    assert proof["schemaVersion"] == 2 and proof["routingSourceOverride"] == override
    for field in ["onlyReviewedEmbeddedDeclarationsChanged", "allPackageFilesVerified", "unchangedDependencyGraphExceptAutorouterAlias",
                  "mainCoreAndEvalResolveSelectedAutorouter", "publishedCoreUnchanged", "autorouterDependencyLinkPreserved", "publishedAssessmentHelperPreserved"]:
        assert proof[field] is True
    for field in ["sourceMappingSha256", "publishedAutorouterSha256", "candidateAutorouterSha256", "publishedCoreSha256", "changedDeclarations"]:
        assert proof[field] == override[field]
    assert proof["replacedDeclarations"] == plan["overlay"]["replace"] and proof["insertedDeclarations"] == plan["overlay"]["insert"]
    restoration = archive.json("via-site-bounds/assessment-runtime-restored.json")
    assert restoration["publishedAliasesRestored"] is True and restoration["allPublishedFilesVerified"] is True
    assert restoration["routingSourceOverride"] is None
    for record in [proof, restoration]:
        assert record["publishedManifestSha256"] == digest(published_bytes)
        assert record["candidateManifestSha256"] == digest(candidate_bytes)
    baseline_proof = archive.json("via-site-bounds/published-baseline-proof.json")
    assert baseline_proof["allPublishedFilesVerified"] is True and baseline_proof["historicalBaselineIsReferenceOnly"] is True
    assert baseline_proof["publishedManifestSha256"] == digest(published_bytes)
    assert baseline_proof["runtimeGuardSha256"] == digest(archive.data("via-site-bounds/runtime-guard.json.gz"))
    aliases_before, aliases_after = published["packageAliases"], candidate["packageAliases"]
    assert len(aliases_before) == len(aliases_after)
    changed = 0
    for before, after in zip(aliases_before, aliases_after):
        if before == after:
            continue
        assert before["alias"].endswith("/node_modules/@tscircuit/capacity-autorouter")
        assert {key: value for key, value in before.items() if key != "target"} == {key: value for key, value in after.items() if key != "target"}
        ar = next(row for row in candidate["packages"] if row["name"] == "@tscircuit/capacity-autorouter")
        assert ar["entry"] == after["target"] + "/" + ar["entryRelative"]
        changed += 1
    assert changed == 1
    return published, candidate


def verify_case_descriptor(task, before, after):
    scalar_fields = ["id", "cohort", "mode", "fanout", "planes", "sourceSha256", "expectedComponents", "expectedPads",
                     "expectedNativeNets", "expectedNets", "expectedRoutableNets", "captureDeadlineMs", "hardDeadlineMs", "assessmentDeadlineMs"]
    for field in scalar_fields:
        assert task[field] == before["progress"][field]
        if after["progress"]:
            assert task[field] == after["progress"][field]
    for field in ["implementationFiles", "assessmentSourceFiles"]:
        identity = lambda rows: sorted((row["path"].split("/sources/", 1)[-1], row["sha256"]) for row in rows)
        assert identity(task[field]) == identity(before["progress"][field])
        if after["progress"]:
            assert identity(task[field]) == identity(after["progress"][field])


def read_lane(archive, context):
    board, cohort, native = context["board"], context["cohort"], context["native"]
    names = archive.zip.namelist()
    missing_records = [name for name in ["result.json", "progress.json", "process.json"] if name not in names]
    result, progress, process = (archive.json(name + ".json") if name + ".json" in names else {} for name in ["result", "progress", "process"])
    for record in [result, progress, process]:
        if not record:
            continue
        assert record["id"] == board and record["cohort"] == cohort
        assert record["executionMode"] == "full" and record["mode"] == "phased"
        assert record["captureDeadlineMs"] == 900000 and record["hardDeadlineMs"] == 960000
    geometry = None
    copper = None
    physical_records = None
    if "circuit.json.gz" in names:
        circuit, raw_sha = archive.gz_json("circuit.json.gz")
        static = sorted(canonical(row) for row in circuit if row["type"] in GEOMETRY_TYPES)
        geometry = {"sha256": digest("\n".join(static).encode()), "elements": len(static), "circuitSha256": raw_sha}
        copper = {kind: {"count": sum(row["type"] == kind for row in circuit),
                         "sha256": digest(canonical(sorted(canonical(row) for row in circuit if row["type"] == kind)).encode())}
                  for kind in ["pcb_trace", "pcb_via", "pcb_copper_pour"]}
    if missing_records:
        return {"result": result, "progress": progress, "assessment": None, "connectedNativeNames": None,
                "physicalFindings": None, "physicalFindingRecords": None, "geometry": geometry, "copper": copper, "stopReason": "missing_case_records",
                "missingRecords": missing_records, "lastSavedProgressMs": progress.get("elapsedMs"),
                "renderWallMs": result.get("renderWallMs"), "checkpointAgeMs": None}
    assert progress["assessmentDeadlineMs"] == 180000
    assert progress["sourceSha256"] == native["sha256"]
    assert progress["expectedRoutableNets"] == result["requestedRoutableNets"] == COUNTS[board]
    assert progress["fanout"] is False and progress["planes"] is (cohort == "original")
    assert progress["forbiddenRoutingSolverSelections"] == [] and progress["runtime"]["cacheEngine"] is False
    assert not result["wasmUsage"]["routingOrUnknownAttempts"]
    assert process["memoryCap"] is None
    for key in ["hardTimedOut", "renderExitCode", "renderWallMs", "captureDeadlineMs", "hardDeadlineMs"]:
        assert result[key] == process[key]
    expected_packages = {row["name"]: (row["version"], row["entrySha256"]) for row in context["manifest"]["packages"]}
    assert {row["name"]: (row["version"], row["entrySha256"]) for row in progress["runtime"]["packages"]} == expected_packages
    override = context["manifest"].get("routingSourceOverride")
    if override is None:
        assert not progress["runtime"]["routingSourceOverride"] and not progress.get("routingSourceOverride")
        assert result["dependencyOverrides"] == []
    else:
        assert progress["runtime"]["routingSourceOverride"] == progress["routingSourceOverride"] == override
        assert result["routingSourceOverride"] == process["routingSourceOverride"] == override
        assert result["dependencyOverrides"] == progress["dependencyOverrides"] == [override]
    assessment = archive.json("assessment.json") if result.get("assessmentReady") and "assessment.json" in names else None
    connected = None
    if assessment is not None:
        assert result["auditExitCode"] == 0 and result["auditTimedOut"] is False
        requested = assessment["routableNets" if cohort == "original" else "requestedNets"]
        assert requested == COUNTS[board]
        missing = [row["name"] for row in assessment["missingCopper"]] if cohort == "original" else assessment["unconnectedNets"]
        assert len(missing) == len(set(missing)) and set(missing) <= native["names"]
        connected = sorted(native["names"] - set(missing))
        assert len(connected) == assessment["connectedNets"] == result["connectedNets"]
        assert len(assessment["geometryErrors"]) == result["geometryErrorCount"]
        if cohort == "original":
            assert len(assessment["membershipErrors"]) == result["membershipErrorCount"]
        physical = {key: assessment["findings"][key if cohort == "original" else alias] for key, alias in PHYSICAL_GROUPS.items()}
        assert physical == result["sharedDrcByGroup"] and sum(physical.values()) == result["sharedDrcErrorCount"]
        findings, _ = archive.gz_json("findings.json.gz")
        physical_records = {key: findings[alias] for key, alias in PHYSICAL_GROUPS.items()}
        assert {key: len(rows) for key, rows in physical_records.items()} == physical
    else:
        if result.get("assessmentReady"):
            missing_records.append("assessment.json")
        physical = None
    stop = ("hard_capture_deadline" if result["hardTimedOut"] else
            "soft_capture_deadline" if progress["status"] == "capture_deadline" else
            "solver_failed" if any(phase["status"] == "failed" for phase in progress["phases"]) else
            "render_settled" if result["renderSettled"] else "unfinished_or_execution_error")
    return {"result": result, "progress": progress, "assessment": assessment, "connectedNativeNames": connected,
            "physicalFindings": physical, "physicalFindingRecords": physical_records, "geometry": geometry, "copper": copper, "stopReason": stop, "missingRecords": missing_records,
            "lastSavedProgressMs": progress["elapsedMs"], "renderWallMs": result["renderWallMs"],
            "checkpointAgeMs": max(0, result["renderWallMs"] - progress["elapsedMs"])}


def compare_case(spec, context):
    board, cohort, lane_name = spec["board"], spec["cohort"], spec["lane"]
    native = native_source(spec, context["provenance"])
    archives = []
    for field, name, control in [
        ("baselineCaseProof", f"full-board-{board}-published-{cohort}", True),
        ("baselineSummaryProof", f"full-board-{board}-published-summary", True),
        ("candidateCase", f"via-site-bounds-{lane_name}-{board}-{cohort}-case", False),
        ("candidateSummary", f"via-site-bounds-{lane_name}-{board}-{cohort}-summary", False),
    ]:
        archives.append(Archive(spec[field], {"name": name, "run": CONTROL_RUN if control else context["request"]["candidateRunId"],
                         "head": CONTROL_HEAD if control else context["request"]["candidateHead"],
                         "control": context["controlArtifacts"] if control else None}))
    try:
        base_case, base_summary, candidate_case, candidate_summary = archives
        base_manifest = base_summary.json(".full-board-run/runtime-manifest.json")
        published, candidate = verify_candidate_proofs(candidate_summary, context)
        release, mapping = context["release"], context["mapping"]
        for name in ["release.json", "source-provenance.json", "harness-provenance.json", "baseline-run-plan.json"]:
            assert base_summary.data("experiments/full-board-ten/" + name) == (CONTROLLER / name).read_bytes()
        for manifest in [base_manifest, published]:
            verify_published(manifest)
            verify_runtime(manifest, (release, mapping["originalAutorouterSha256"], base_manifest, 0))
        assert package_identity(base_manifest) == package_identity(published)
        entry_delta = sum(len(span["replacementText"].encode()) - len(span["originalText"].encode()) for span in mapping["spans"])
        verify_runtime(candidate, (release, mapping["candidateAutorouterSha256"], base_manifest, entry_delta))
        override = candidate["routingSourceOverride"]
        helper_before = verify_assessment_helper(base_summary.json(".full-board-run/cases/assessment-helper-proof.json"), release)
        helper_after = verify_assessment_helper(candidate_summary.json("cases/assessment-helper-proof.json"), release)
        assert helper_before == helper_after
        # Bind all small case records to their separately authenticated summary copies.
        for stem in ["result", "progress", "process"]:
            assert base_case.data(stem + ".json") == base_summary.data(f".full-board-run/results/{board}/{cohort}/{stem}.json")
        shared = {"board": board, "cohort": cohort, "native": native}
        before = read_lane(base_case, {**shared, "manifest": base_manifest})
        after = read_lane(candidate_case, {**shared, "manifest": candidate})
        task = candidate_summary.json(f"lanes/candidate/cases/{board}-{cohort}.json")
        assert task["experiment"] == context["plan"]["experiment"] and task["routingSourceOverride"] == override and task["dependencyOverrides"] == [override]
        assert task["restorePublishedCoreBeforeAssessment"] and task["runtimeManifestPath"].endswith("/candidate-runtime-manifest.json")
        verify_case_descriptor(task, before, after)
        if after["progress"]:
            for field in ["coarseRoutingInstrumentation", "initialCopperCounts"]:
                if field in after["progress"]:
                    assert before["progress"][field] == after["progress"][field]
        available = before["connectedNativeNames"] is not None and after["connectedNativeNames"] is not None
        gained = sorted(set(after["connectedNativeNames"]) - set(before["connectedNativeNames"])) if available else None
        lost = sorted(set(before["connectedNativeNames"]) - set(after["connectedNativeNames"])) if available else None
        geometry_equal = (before["geometry"] is not None and after["geometry"] is not None and
                          before["geometry"]["sha256"] == after["geometry"]["sha256"])
        rows = {}
        for name, lane in [("baseline", before), ("candidate", after)]:
            assessment = lane["assessment"]
            rows[name] = {key: lane[key] for key in ["connectedNativeNames", "physicalFindings", "physicalFindingRecords", "geometry", "copper", "stopReason", "lastSavedProgressMs", "renderWallMs", "checkpointAgeMs"]}
            rows[name].update(assessmentAvailable=assessment is not None, connectedNets=len(lane["connectedNativeNames"]) if assessment is not None else None,
                              completeAndClean=lane["result"].get("completeAndClean") if assessment is not None else None,
                              completeSourceCounts=lane["result"].get("completeSourceCounts"), missingRecords=lane["missingRecords"],
                              allFindingCategories=assessment["findings"] if assessment is not None else None,
                              geometryErrors=assessment["geometryErrors"] if assessment is not None else None,
                              membershipErrors=assessment.get("membershipErrors") if assessment is not None else None,
                              lastPhase=lane["result"].get("lastPhase"), lastError=lane["result"].get("lastError"))
        return {"board": board, "cohort": cohort, "lane": lane_name, "requestedNets": COUNTS[board], "sourceSha256": native["sha256"],
                "nativeNamesSha256": digest(canonical(sorted(native["names"])).encode()),
                "comparisonAvailable": available, "geometryPreserved": geometry_equal,
                "gainedNativeNets": gained, "lostNativeNets": lost,
                "physicalFindingChanges": finding_changes(before["physicalFindingRecords"], after["physicalFindingRecords"]) if available else None,
                "physicalFindingCountDelta": {key: after["physicalFindings"][key] - before["physicalFindings"][key] for key in PHYSICAL_GROUPS} if available else None,
                "archives": [{"id": item.metadata["id"], "name": item.metadata["name"], "sha256": item.sha256} for item in archives], **rows}
    finally:
        for archive in archives:
            archive.zip.close()


def finding_changes(before, after):
    changes = {}
    for category in PHYSICAL_GROUPS:
        previous = Counter(canonical(row) for row in before[category])
        current = Counter(canonical(row) for row in after[category])
        changes[category] = {
            "before": sum(previous.values()), "after": sum(current.values()),
            "resolved": [json.loads(row) for row in sorted((previous - current).elements())],
            "introduced": [json.loads(row) for row in sorted((current - previous).elements())],
            "unchanged": sum((previous & current).values()),
        }
    return changes


def main(request_path):
    request = read_json(request_path)
    plan = read_json(CONTROLLER / "via-site-bounds-plan.json")
    assert isinstance(request["candidateRunId"], int) and request["candidateRunId"] > 0
    assert re.fullmatch(r"[0-9a-f]{40}", request["candidateHead"])
    cases = request["cases"]
    expected = {("bounds-fix", row["board"], row["cohort"]) for row in plan["cases"]}
    assert len(expected) == 9 and ("bounds-fix", "h616", "spaced") not in expected
    assert len(cases) == 9 and {(row["lane"], row["board"], row["cohort"]) for row in cases} == expected
    assert plan["laneOrder"] == ["bounds-fix"] and set(plan["lanes"]) == set(plan["laneOrder"])
    paired_proof_bytes = (CONTROLLER / plan["pairedByteProofFile"]).read_bytes()
    assert digest(paired_proof_bytes) == plan["pairedByteProofSha256"]
    paired_proof = json.loads(paired_proof_bytes)
    assert paired_proof["passed"] and paired_proof["completeBundlesEqualAfterExactlyFourBoundEdits"]
    assert paired_proof["outsideMappedPublishedBytesUnchangedBothLanes"]
    assert plan["historicalBaseline"]["runId"] == CONTROL_RUN and plan["historicalBaseline"]["head"] == CONTROL_HEAD
    controller_handoff_data = (CONTROLLER / "published-baseline-controller-handoff.json").read_bytes()
    assert digest(controller_handoff_data) == CONTROL_CONTROLLER_HANDOFF_SHA == plan["historicalBaseline"]["controllerHandoffSha256"]
    controller_handoff = json.loads(controller_handoff_data)
    assert controller_handoff["controllerCommit"] == CONTROL_HEAD and controller_handoff["mainVersion"] == "0.0.3243"
    handoff_data = Path(request["baselineHandoffPath"]).read_bytes()
    assert re.fullmatch(r"[0-9a-f]{64}", request["baselineHandoffSha256"])
    assert digest(handoff_data) == request["baselineHandoffSha256"]
    handoff = json.loads(handoff_data)
    assert handoff["runId"] == CONTROL_RUN and handoff["head"] == CONTROL_HEAD
    assert handoff["mainVersion"] == "0.0.3243" and handoff["allArtifactsRetainedAndAuthenticated"] is True
    assert len(handoff["artifacts"]) == len({row["artifactId"] for row in handoff["artifacts"]}) == 15
    rows, mapping_hashes, sources = [], {}, {}
    for lane in plan["laneOrder"]:
        selected = plan["lanes"][lane]
        selected_plan = {**plan, **selected, "runtime": {**plan["runtime"], **selected["runtime"]}}
        mapping_bytes = (CONTROLLER / selected["sourceMappingFile"]).read_bytes()
        mapping = json.loads(mapping_bytes)
        assert digest(mapping_bytes) == selected["sourceMappingSha256"]
        assert mapping["passed"] is True and mapping["sourceFrozen"] is True
        assert mapping["source"] == selected["source"]
        assert len(mapping["spans"]) == len(selected["overlay"]["replace"]) + len(selected["overlay"]["insert"])
        for kind in ["replace", "insert"]:
            assert [row["name"] for row in mapping["spans"] if row["kind"] == kind] == selected["overlay"][kind]
        context = {"request": request, "plan": selected_plan, "mapping": mapping, "mappingBytes": mapping_bytes,
                   "release": read_json(CONTROLLER / "release.json"), "provenance": read_json(CONTROLLER / "source-provenance.json"),
                   "controlArtifacts": {row["artifactId"]: row for row in handoff["artifacts"]}}
        for spec in cases:
            assert spec["lane"] == lane
            rows.append(compare_case(spec, context))
        mapping_hashes[lane] = digest(mapping_bytes)
        sources[lane] = mapping["source"]
    comparable = all(row["comparisonAvailable"] for row in rows)
    totals = {
        "requestedNets": sum(row["requestedNets"] for row in rows),
        "publishedConnected": sum(row["baseline"]["connectedNets"] for row in rows) if comparable else None,
        "candidateConnected": sum(row["candidate"]["connectedNets"] for row in rows) if comparable else None,
        "gained": sum(len(row["gainedNativeNets"]) for row in rows) if comparable else None,
        "lost": sum(len(row["lostNativeNets"]) for row in rows) if comparable else None,
    }
    assert totals["requestedNets"] == plan["expectedRoutableNetsTotal"] == 2735
    result = {"schemaVersion": 2, "controlRun": CONTROL_RUN, "controlHead": CONTROL_HEAD,
              "candidateRun": request["candidateRunId"], "candidateHead": request["candidateHead"],
              "mappingSha256ByLane": mapping_hashes, "sourceByLane": sources, "pairedByteProofSha256": digest(paired_proof_bytes),
              "baselineArtifactHandoffSha256": digest(handoff_data), "baselineControllerHandoffSha256": digest(controller_handoff_data),
              "authenticatedCases": len(rows), "comparisonComplete": comparable, "cases": rows, "totals": totals,
              "scope": "Remaining nine native cases versus authenticated retained published3243; H616 spaced is excluded. This is regression coverage for the combined existing feature plus bounds correction. Only the separate paired H616 run attributes the four-expression correction. No speedup claim."}
    Path(request["outputPath"]).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"comparisonComplete": comparable, **totals}))


if __name__ == "__main__":
    assert len(sys.argv) == 2, "Usage: compare-via-site-bounds.py REQUEST.json"
    main(sys.argv[1])
