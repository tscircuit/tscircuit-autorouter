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
SPEC = importlib.util.spec_from_file_location("carrier", ROOT / "scripts/experiment-audit/witness-quality6-artifact-carrier.py")
C = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(C)
RUN, SHA, MANIFEST_SHA, REPO_ID = "123456789", "a" * 40, "b" * 64, 924883209
REPO = C.REPOSITORY


def run_metadata():
    return {"id": int(RUN), "head_sha": SHA, "run_attempt": 1, "path": C.WORKFLOW,
            "repository": {"id": REPO_ID, "full_name": REPO}}


def artifact_metadata(raw, index=0, feature="witness-via-pad-sample-003", dataset="srj18", order="BA"):
    return {"id": 9000 + index, "name": f"witness-quality6-raw-{feature}-{dataset}-{order}",
            "size_in_bytes": len(raw), "digest": "sha256:" + C.sha(raw), "expired": False,
            "workflow_run": {"id": int(RUN), "head_sha": SHA, "repository_id": REPO_ID, "head_repository_id": REPO_ID}}


def manifest():
    return {"repository": REPO, "campaign": "witness-quality6-repeat-20261029",
            "cases": [{"dataset": "srj24", "sample": 8, "order": "AB"}, {"dataset": "srj18", "sample": 3, "order": "BA"}, {"dataset": "srj24", "sample": 14, "order": "AB"}],
            "plannedJobs": 3, "plannedAttempts": 6, "heldOut": False, "fullPopulationSweep": False, "speedClaim": False,
            "candidate": {"id": "witness-via-pad", "candidateSha": "2109f9e96957c06f23aef2b079f6d59fba23ea52", "candidateTree": "83d39c038ba8bdbb01fc53728e5069fd594d2d23"}}


def encode(spec, payload):
    stream = io.StringIO()
    C.emit_segment(spec, payload, stream)
    return "setup\n" + "\n".join("2026-10-29T18:00:00.1234567Z " + line for line in stream.getvalue().splitlines()) + "\nend\n"


def main():
    checks = []
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

    # API pagination must include all four exact raw artifact names beyond page one.
    artifacts = [artifact_metadata(b"small", index, f"witness-via-pad-sample-{n:03d}", d, o) for index, (d, n, o) in enumerate([("srj24", 8, "AB"), ("srj18", 3, "BA"), ("srj24", 14, "AB")])]
    all_items = [{"id": index + 100, "name": f"metrics-{index}"} for index in range(100)] + artifacts
    calls = []
    def fake_api(path):
        calls.append(path)
        if path.endswith("/" + RUN):
            return run
        page = int(urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)["page"][0])
        return {"total_count": len(all_items), "artifacts": all_items[(page - 1) * 100:page * 100]}
    planned = C.plan(manifest(), run_id=RUN, controller_sha=SHA, repository=REPO, manifest_sha256=MANIFEST_SHA, api_get=fake_api)
    assert planned["carrier_jobs"] == 3 and any("page=2" in path for path in calls)
    checks.append("artifact-pagination-beyond-first100")
    saved = copy.deepcopy(all_items)
    all_items.append(copy.deepcopy(artifacts[0]))
    reject("duplicate-raw-artifact-name", lambda: C.plan(manifest(), run_id=RUN, controller_sha=SHA, repository=REPO, manifest_sha256=MANIFEST_SHA, api_get=fake_api))
    all_items[:] = copy.deepcopy(saved); all_items[-1]["name"] = "witness-quality6-raw-witness-via-pad-sample-014-srj24-BA"
    reject("missing-or-extra-raw-artifact", lambda: C.plan(manifest(), run_id=RUN, controller_sha=SHA, repository=REPO, manifest_sha256=MANIFEST_SHA, api_get=fake_api))
    all_items[:] = copy.deepcopy(saved)
    for item in all_items[-2:]: item["size_in_bytes"] = 129 * C.PART_BYTES
    reject("matrix-over256-fails-without-omission", lambda: C.plan(manifest(), run_id=RUN, controller_sha=SHA, repository=REPO, manifest_sha256=MANIFEST_SHA, api_get=fake_api))

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
