#!/usr/bin/env python3
"""Pure mocked transport integrity tests; no real boards or network."""
import base64
import copy
import importlib.util
import io
import json
import pathlib
import random
import tempfile
import urllib.error
import urllib.parse
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("carrier", ROOT / "scripts/experiment-audit/owner-feedback-artifact-carrier.py")
C = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(C)
RUN, SHA, MANIFEST_SHA, REPO_ID = "123456789", "a" * 40, "b" * 64, 924883209
REPO = C.REPOSITORY


def run_metadata():
    return {"id": int(RUN), "head_sha": SHA, "run_attempt": 1, "path": C.WORKFLOW,
            "repository": {"id": REPO_ID, "full_name": REPO}}


def artifact_metadata(raw, index=0, feature="owner-feedback", dataset="srj18", shard=0):
    return {"id": 9000 + index, "name": f"owner-feedback4-raw-{feature}-{dataset}-shard{shard}",
            "size_in_bytes": len(raw), "digest": "sha256:" + C.sha(raw), "expired": False,
            "workflow_run": {"id": int(RUN), "head_sha": SHA, "repository_id": REPO_ID, "head_repository_id": REPO_ID}}


def manifest():
    return {"repository": REPO, "campaign": "owner-feedback4-20261030", "plannedAttempts": 4, "plannedJobs": 2,
            "candidate": {"id": "owner-feedback", "candidateSha": C.SOURCE_PIN, "candidateTree": C.TREE_PIN,
                          "option": "experimentLayerAwareMstIdentity", "options": {"cacheProvider": None, "effort": 1, "experimentLayerAwareMstIdentity": True, "experimentOriginalOwnerCopperFeedback": True}},
            "shards": C.expected_shards()}



def encode(spec, payload):
    stream = io.StringIO()
    C.emit_segment(spec, payload, stream)
    return "setup\n" + "\n".join("2026-10-29T18:00:00.1234567Z " + line for line in stream.getvalue().splitlines()) + "\nend\n"


def main():
    checks = []
    saved_source, saved_tree = C.SOURCE_PIN, C.TREE_PIN
    C.SOURCE_PIN, C.TREE_PIN = "0" * 40, "1" * 40
    try:
        C.plan(manifest(), run_id=RUN, controller_sha=SHA, repository=REPO, manifest_sha256=MANIFEST_SHA, api_get=lambda path: (_ for _ in ()).throw(AssertionError("Unsealed plan reached network")))
    except ValueError:
        checks.append("unsealed-source-blocks-plan-before-network")
    else:
        raise AssertionError("Unsealed source plan accepted")
    C.SOURCE_PIN, C.TREE_PIN = "2" * 40, "3" * 40
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", compression=zipfile.ZIP_STORED) as zipped:
        zipped.writestr("original.bin", random.Random(99).randbytes(2 * C.PART_BYTES + 177))
    original = data.getvalue()
    metadata, run = artifact_metadata(original), run_metadata()
    source = C.run_pin(run, run_id=RUN, controller_sha=SHA, repository=REPO)
    pin = C.artifact_pin(metadata, source)
    specs = [C.make_spec(pin, source, MANIFEST_SHA, index) for index in range(3)]
    jobs = [{"id": 7000 + index, "run_id": int(RUN), "head_sha": SHA, "run_attempt": 1,
             "name": spec["job_name"], "status": "completed", "conclusion": "success"} for index, spec in enumerate(specs)]
    logs = [{"job_id": job["id"], "text": encode(spec, original)} for spec, job in zip(specs, jobs)]
    with tempfile.TemporaryDirectory(prefix="carrier-test-") as temporary:
        root = pathlib.Path(temporary)
        def restore(records=logs, *, artifact=metadata, expected_run=run, expected_jobs=jobs, manifest_sha=MANIFEST_SHA, output=None):
            return C.restore(records, output or root / ("out-" + str(len(checks)) + ".zip"), expected_artifact=artifact,
                             expected_run=expected_run, expected_jobs=expected_jobs, expected_manifest_sha256=manifest_sha)
        def reject(label, fn):
            try:
                fn()
            except (ValueError, TypeError, KeyError):
                checks.append(label)
                return
            raise AssertionError("Accepted invalid transport: " + label)
        result = restore(list(reversed(logs)))
        assert pathlib.Path(result["archive_path"]).read_bytes() == original
        assert result["whole_sha256"] == C.sha(original) and result["archiveRepackedOrExtracted"] is False
        assert [item["part_index"] for item in result["parts"]] == [0, 1, 2]
        assert specs[-1]["segment_bytes"] < C.PART_BYTES
        checks.append("exact-original-ZIP-three-parts-unordered-parallel-jobs-lastpart")
        reject("missing-part-log", lambda: restore(logs[:-1]))
        reject("duplicate-job-log", lambda: restore([logs[0], logs[0], logs[2]]))
        wrong = copy.deepcopy(logs); wrong[0]["job_id"] = 123
        reject("foreign-log-job-ID", lambda: restore(wrong))
        for field, value, label in [("run_attempt", 2, "foreign-job-attempt"), ("head_sha", "e" * 40, "foreign-job-head"),
                                    ("run_id", int(RUN) + 1, "foreign-job-run"), ("conclusion", "failure", "failed-carrier-job")]:
            altered = copy.deepcopy(jobs); altered[0][field] = value
            reject(label, lambda altered=altered: restore(expected_jobs=altered))
        altered = copy.deepcopy(jobs); altered[-1]["id"] += 999; altered[-1]["name"] = altered[0]["name"]
        reject("same-part-replayed-with-new-job-ID", lambda: restore(expected_jobs=altered))
        reject("missing-selected-job-pin", lambda: restore(expected_jobs=jobs[:-1]))
        reject("foreign-external-manifest", lambda: restore(manifest_sha="e" * 64))
        altered = copy.deepcopy(metadata); altered["workflow_run"]["head_sha"] = "e" * 40
        reject("foreign-artifact-lineage", lambda: restore(artifact=altered))
        altered = copy.deepcopy(metadata); altered["digest"] = "sha256:" + "0" * 64
        reject("foreign-original-ZIP-digest", lambda: restore(artifact=altered))
        lines = [line for line in logs[0]["text"].splitlines() if C.FRAME.fullmatch(line)]
        variants = [("missing-end-marker", lines[:-1]), ("duplicate-data-frame", lines[:2] + lines[1:]),
                    ("replayed-stream", lines + lines[:1])]
        swapped = lines.copy(); swapped[1], swapped[2] = swapped[2], swapped[1]
        variants.append(("out-of-order-data", swapped))
        for label, frames in variants:
            changed = copy.deepcopy(logs); changed[0]["text"] = "\n".join(frames)
            reject(label, lambda changed=changed: restore(changed))
        changed = copy.deepcopy(logs); changed[0]["text"] = logs[0]["text"].replace('"seq":0', '"seq":0,"seq":0', 1)
        reject("duplicate-JSON-key", lambda: restore(changed))
        for field, value, label in [("offset", 1, "unaligned-offset"), ("part_index", True, "bool-part-index"),
                                    ("version", True, "bool-version"), ("artifact_id", True, "bool-artifact-ID"),
                                    ("part_count", 4, "wrong-part-count")]:
            bad = dict(specs[0], **{field: value})
            reject(label, lambda bad=bad: C.validate_spec(bad))
        reject("wrong-last-part-size", lambda: C.validate_spec(dict(specs[-1], segment_bytes=C.PART_BYTES)))
        original_frame = json.loads(C.FRAME.fullmatch(lines[1])[1])
        for first, label in [("!", "invalid-base64"), ("A" if original_frame["data"][0] != "A" else "B", "changed-segment-bytes")]:
            frame = dict(original_frame, data=first + original_frame["data"][1:])
            changed = copy.deepcopy(logs)
            changed[0]["text"] = logs[0]["text"].replace(lines[1], "2026-10-29T18:00:00Z " + C.PREFIX + C.canonical(frame).decode())
            reject(label, lambda changed=changed: restore(changed))
        # Individually valid segment hashes are insufficient: a different part's
        # bytes with a fully resealed stream must fail the original whole ZIP hash.
        valid_wrong_part = []
        for line in logs[0]["text"].splitlines():
            match = C.FRAME.fullmatch(line)
            if not match:
                continue
            frame = json.loads(match[1])
            if frame["kind"] == "begin":
                frame["spec"] = specs[1]
            elif frame["kind"] == "end":
                frame["part_index"] = 1
            valid_wrong_part.append("2026-10-29T18:00:00Z " + C.PREFIX + C.canonical(frame).decode())
        wrong_text = "\n".join(valid_wrong_part)
        assert C.decode_segment(wrong_text, specs[1]) == original[:C.PART_BYTES]
        mixed = copy.deepcopy(logs)
        mixed[1]["text"] = wrong_text
        reject("valid-resealed-wrong-part-fails-whole-original-hash", lambda: restore(mixed))
        class MockClient:
            def api_get(self, path):
                return run if path.endswith("/" + RUN) else metadata
            def download(self, artifact_id, size):
                assert artifact_id == metadata["id"] and size == len(original)
                return original
        carried = io.StringIO()
        C.carry(specs[0], repository=REPO, client=MockClient(), stream=carried)
        assert C.decode_segment(carried.getvalue(), specs[0]) == original[:C.PART_BYTES]
        checks.append("carry-fresh-API-lineage-and-fullZIP-digest-before-emit")
        reject("producer-full-ZIP-digest-before-emitting", lambda: C.emit_segment(specs[0], b"wrong", io.StringIO()))
        existing = root / "existing.zip"; existing.write_bytes(b"existing evidence")
        reject("never-overwrite-original-evidence", lambda: restore(output=existing))
        assert existing.read_bytes() == b"existing evidence"
        assert not list(root.glob("tmp*")), "Failed restoration retained temporary payloads"
        checks.append("failed-restores-remove-temporary-payloads")

    # Every original server artifact must be selected even beyond API page one.
    layout = [(dataset, shard) for dataset, count in [("srj18", 1), ("srj24", 1)] for shard in range(count)]
    artifacts = [artifact_metadata(b"small", index, dataset=dataset, shard=shard) for index, (dataset, shard) in enumerate(layout)]
    all_items = [{"id": index + 100, "name": f"metrics-{index}"} for index in range(100)] + artifacts
    calls = []
    def fake_api(path):
        calls.append(path)
        if path.endswith("/" + RUN):
            return run
        page = int(urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)["page"][0])
        return {"total_count": len(all_items), "artifacts": all_items[(page - 1) * 100:page * 100]}
    def plan(value=None):
        return C.plan(manifest() if value is None else value, run_id=RUN, controller_sha=SHA, repository=REPO, manifest_sha256=MANIFEST_SHA, api_get=fake_api)
    planned = plan()
    assert planned["carrier_jobs"] == 2 and any("page=2" in path for path in calls)
    checks.append("artifact-pagination-beyond-first100")
    assert len(planned["artifact_pins"]) == 2 and {pin["artifact_name"] for pin in planned["artifact_pins"]} == {item["name"] for item in artifacts}
    checks.append("both-targeted-original-artifacts-exactly-once")
    scope = manifest()
    orders = [case["order"] for shard in scope["shards"] for case in shard["cases"]]
    assert orders.count("AB") == orders.count("BA") == 1
    assert len({(shard["dataset"], case["sample"]) for shard in scope["shards"] for case in shard["cases"]}) == 2
    for dataset, sample, expected in [("srj18", 11, "AB"), ("srj24", 8, "BA")]:
        assert [case["order"] for shard in scope["shards"] if shard["dataset"] == dataset for case in shard["cases"] if case["sample"] == sample] == [expected]
    checks.append("prospective-within-host-target-orders-one-each")
    assert all(C.digest(case["inputHash"]) for shard in scope["shards"] for case in shard["cases"])
    checks.append("exact-input-digests-preserve-original-case-denominator")
    saved = copy.deepcopy(all_items)
    all_items.append(copy.deepcopy(artifacts[0]))
    reject("duplicate-raw-artifact-name", plan)
    all_items[:] = copy.deepcopy(saved); all_items[-1]["name"] = "owner-feedback4-raw-foreign-srj24-shard6"
    reject("missing-or-extra-raw-artifact", plan)
    all_items[:] = copy.deepcopy(saved)
    for item in all_items[-2:]: item["size_in_bytes"] = 129 * C.PART_BYTES
    reject("matrix-over256-fails-without-omission", plan)
    all_items[:] = copy.deepcopy(saved); all_items[-1]["id"] = all_items[-2]["id"]
    reject("duplicate-original-artifact-ID-across-shards", plan)
    all_items[:] = copy.deepcopy(saved)
    mutations = []
    value = manifest(); value["shards"].pop(); mutations.append(("missing-shard", value))
    value = manifest(); value["shards"][-1] = copy.deepcopy(value["shards"][-2]); mutations.append(("duplicate-shard", value))
    value = manifest(); value["shards"][0], value["shards"][1] = value["shards"][1], value["shards"][0]; mutations.append(("reordered-shards", value))
    value = manifest(); value["shards"][0]["cases"].pop(); mutations.append(("missing-case", value))
    value = manifest(); value["shards"][0]["cases"].append(copy.deepcopy(value["shards"][0]["cases"][0])); mutations.append(("duplicate-case-within-shard", value))
    value = manifest(); value["shards"][0]["cases"][0]["sample"] = 2; mutations.append(("wrong-targeted-original-case", value))
    value = manifest(); value["shards"][-1]["cases"][-1]["sample"] = 27; mutations.append(("outside-original-population", value))
    value = manifest(); value["shards"][0]["cases"][0]["sample"] = True; mutations.append(("bool-original-case", value))
    value = manifest(); value["shards"][0]["shardIndex"] = False; mutations.append(("bool-shard-index", value))
    value = manifest(); value["shards"][0]["shardCount"] = 5; mutations.append(("wrong-targeted-shard-count", value))
    value = manifest(); value["shards"][0]["cases"][0]["order"] = "BA"; mutations.append(("wrong-prospective-first-arm-order", value))
    value = manifest(); value["shards"][0]["cases"][0]["order"], value["shards"][1]["cases"][0]["order"] = "BA", "AB"; mutations.append(("balanced-total-but-wrong-within-host-order", value))
    value = manifest(); value["shards"][0]["cases"][0]["inputHash"] = "bad"; mutations.append(("invalid-input-digest", value))
    value = manifest(); value["shards"][0]["cases"][0]["inputHash"] = "f" * 64; mutations.append(("valid-but-unpinned-input-digest", value))
    value = manifest(); value["shards"][0]["cases"][0], value["shards"][1]["cases"][0] = value["shards"][1]["cases"][0], value["shards"][0]["cases"][0]; mutations.append(("cross-dataset-target-cases-swapped", value))
    value = manifest(); value["candidate"]["options"]["experimentLayerAwareMstIdentity"] = False; mutations.append(("candidate-option-disabled", value))
    value = manifest(); value["candidate"]["options"]["experimentOriginalOwnerCopperFeedback"] = False; mutations.append(("feedback-option-disabled", value))
    value = manifest(); value["candidate"]["options"].pop("experimentOriginalOwnerCopperFeedback"); mutations.append(("feedback-option-missing", value))
    value = manifest(); value["candidate"]["options"]["extraExperiment"] = True; mutations.append(("unreviewed-extra-option", value))
    value = manifest(); value["plannedAttempts"] = 82; mutations.append(("underreported-attempt-population", value))
    value = manifest(); value["plannedJobs"] = 11.0; mutations.append(("untyped-planned-job-count", value))
    value = manifest(); value["candidate"]["candidateSha"] = "c" * 40; mutations.append(("foreign-candidate-source", value))
    value = manifest(); value["candidate"]["candidateTree"] = "d" * 40; mutations.append(("foreign-candidate-tree", value))
    value = manifest(); value["candidate"]["id"] = "future-point-cache"; mutations.append(("old-cache-experiment-source-scope", value))
    for label, value in mutations:
        reject(label, lambda value=value: plan(value))

    # Mock the signed redirect and prove token never crosses to storage.
    class Response:
        status = 200
        def __init__(self, body): self.body, self.position = body, 0
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def read(self, size):
            raw = self.body[self.position:self.position + size]
            self.position += len(raw)
            return raw
    class Opener:
        def __init__(self, location): self.location, self.requests = location, []
        def open(self, request, timeout):
            self.requests.append(request)
            if len(self.requests) == 1:
                raise urllib.error.HTTPError(request.full_url, 302, "Found", {"Location": self.location}, None)
            assert request.get_header("Authorization") is None
            return Response(b"original")
    opener = Opener("https://productionresultssa0.blob.core.windows.net/actions-results/file?signature=synthetic")
    assert C.GitHubClient("SYNTHETIC_NOT_A_TOKEN", opener).download(9000, 8) == b"original"
    assert opener.requests[0].get_header("Authorization") == "Bearer SYNTHETIC_NOT_A_TOKEN"
    assert opener.requests[1].get_header("Authorization") is None
    checks.append("Authorization-only-API-stripped-before-signed-storage-request")
    for label, location in [("unsafe-http-redirect", "http://productionresultssa0.blob.core.windows.net/file"),
                            ("foreign-storage-host", "https://example.com/file?signature=synthetic"),
                            ("userinfo-redirect", "https://user@productionresultssa0.blob.core.windows.net/file")]:
        opener = Opener(location)
        reject(label, lambda: C.GitHubClient("SYNTHETIC_NOT_A_TOKEN", opener).download(9000, 8))
        assert len(opener.requests) == 1
    print(json.dumps({"status": "PASS_ORIGINAL_SERVER_ZIP_CARRIER_MOCKED_ADVERSARIAL_INTEGRITY", "cases": len(checks),
                      "checks": checks, "syntheticOriginalZipBytes": len(original), "partBytes": C.PART_BYTES,
                      "pureMockOnly": True, "realBoardRouting": 0, "networkRequests": 0}, sort_keys=True))


if __name__ == "__main__":
    main()
