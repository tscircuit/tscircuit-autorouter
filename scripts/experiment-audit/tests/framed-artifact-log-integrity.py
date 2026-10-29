#!/usr/bin/env python3
"""Pure deterministic round trips and adversarial integrity checks; no boards."""
import base64
import copy
import importlib.util
import io
import json
import pathlib
import random
import stat
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("framed_artifact_log", ROOT / "scripts/experiment-audit/framed-artifact-log.py")
CODEC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CODEC)
RUN, SHA, CASE = "123456789", "a" * 40, "srj18:14"
INPUT = "b" * 64


def reseal(header, raw_zip, members):
    manifest = CODEC.canonical(members)
    header = dict(header, zip_bytes=len(raw_zip), zip_sha256=CODEC.digest(raw_zip),
                  zip_chunks=CODEC.chunk_count(len(raw_zip)), manifest_bytes=len(manifest),
                  manifest_sha256=CODEC.digest(manifest), manifest_chunks=CODEC.chunk_count(len(manifest)),
                  member_count=len(members))
    frames = [header]
    for kind, data in [("manifest", manifest), ("zip", raw_zip)]:
        encoded = base64.b64encode(data).decode("ascii")
        frames.extend({"kind": kind, "seq": seq, "data": encoded[start:start + CODEC.CHUNK]}
                      for seq, start in enumerate(range(0, len(encoded), CODEC.CHUNK)))
    frames.append({"kind": "end", "run_id": RUN, "controller_sha": SHA, "case": CASE,
                   "zip_sha256": header["zip_sha256"], "manifest_sha256": header["manifest_sha256"],
                   "zip_chunks": header["zip_chunks"], "manifest_chunks": header["manifest_chunks"]})
    return frames


def log_of(frames):
    return "ordinary job text\n" + "\n".join("2026-10-29T18:00:00.1234567Z " + CODEC.PREFIX + CODEC.canonical(frame).decode("ascii") for frame in frames) + "\nordinary job end\n"


def repack(contents, *, symlink=None, extra=None):
    payload = io.BytesIO()
    members = []
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as target:
        for name, raw in sorted(contents.items()):
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = ((stat.S_IFLNK if name == symlink else stat.S_IFREG) | 0o600) << 16
            target.writestr(entry, raw)
            members.append({"path": name, "bytes": len(raw), "sha256": CODEC.digest(raw)})
        if extra:
            target.writestr(extra[0], extra[1])
    return payload.getvalue(), members


def main():
    cases = []
    with tempfile.TemporaryDirectory(prefix="framed-artifact-tests-") as temporary:
        root = pathlib.Path(temporary)
        source = root / "source"
        source.mkdir()
        provenance = {"githubRunId": RUN, "controllerSha": SHA,
                      "inputIdentity": {"sampleNumber": 14, "inputHash": INPUT},
                      "manifest": {"cases": [{"dataset": "srj18", "sample": 14, "inputHash": INPUT}]}}
        contents = {"profile-provenance.json": CODEC.canonical(provenance),
                    "profile-result.json": CODEC.canonical({"dataset": "srj18", "sampleNumber": 14, "expectedInputHash": INPUT}),
                    "cpu-profiles/synthetic.cpuprofile": random.Random(42).randbytes(24576),
                    "unicode-name-\u03bb.json": "\ufeffevidence\n".encode()}
        for name, raw in contents.items():
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
        stream = io.StringIO()
        first = root / "first.zip"
        header = CODEC.emit(source, first, run_id=RUN, controller_sha=SHA, case=CASE, stream=stream)
        frames = [json.loads(line[len(CODEC.PREFIX):]) for line in stream.getvalue().splitlines()]
        assert header["zip_chunks"] >= 4
        second = root / "second.zip"
        CODEC.emit(source, second, run_id=RUN, controller_sha=SHA, case=CASE, stream=io.StringIO())
        assert first.read_bytes() == second.read_bytes(), "Deterministic ZIP bytes"
        restored = root / "restored.zip"
        result = CODEC.restore(log_of(frames), restored, expected_run_id=RUN, expected_controller_sha=SHA, expected_case=CASE)
        assert restored.read_bytes() == first.read_bytes()
        assert result["profile_identity"] == {"dataset": "srj18", "sample": 14, "inputHash": INPUT}
        cases.append("deterministic-timestamp-prefixed-roundtrip-all-members")
        def reject(label, altered, *, expected_case=CASE):
            path = root / ("reject-" + str(len(cases)) + ".zip")
            try:
                CODEC.restore(altered if isinstance(altered, str) else log_of(altered), path,
                              expected_run_id=RUN, expected_controller_sha=SHA, expected_case=expected_case)
            except (ValueError, KeyError, TypeError, zipfile.BadZipFile):
                assert not path.exists(), "Rejected evidence must not publish a ZIP"
                cases.append(label)
                return
            raise AssertionError("Accepted invalid transport: " + label)
        reject("missing-end", frames[:-1])
        reject("missing-begin", frames[1:])
        reject("truncated-zip-chunks", frames[:-2] + frames[-1:])
        reject("duplicate-data-chunk", frames[:3] + frames[2:])
        altered = copy.deepcopy(frames)
        altered[2], altered[3] = altered[3], altered[2]
        reject("out-of-order-data-chunks", altered)
        altered = copy.deepcopy(frames)
        altered[2]["data"] = "!" + altered[2]["data"][1:]
        reject("invalid-base64", altered)
        altered = copy.deepcopy(frames)
        altered[2]["data"] = ("A" if altered[2]["data"][0] != "A" else "B") + altered[2]["data"][1:]
        reject("zip-byte-digest-mismatch", altered)
        altered = copy.deepcopy(frames)
        altered[0]["zip_sha256"] = "0" * 64
        altered[-1]["zip_sha256"] = "0" * 64
        reject("forged-zip-digest", altered)
        altered = copy.deepcopy(frames)
        altered[0]["zip_bytes"] = CODEC.MAX_ZIP_BYTES + 1
        reject("oversize-archive-header", altered)
        reject("foreign-expected-case", frames, expected_case="srj24:2")
        altered = copy.deepcopy(frames)
        altered[0]["controller_sha"] = "c" * 40
        reject("foreign-controller-header", altered)
        altered = copy.deepcopy(frames)
        altered[-1]["run_id"] = "987654321"
        reject("foreign-end-marker", altered)
        reject("duplicate-after-end", frames + frames[:1])
        altered = log_of(frames).replace('"seq":0', '"seq":0,"seq":0', 1)
        reject("duplicate-json-key", altered)
        members = json.loads(base64.b64decode("".join(frame["data"] for frame in frames if frame.get("kind") == "manifest")))
        bad_members = copy.deepcopy(members)
        bad_members[0]["sha256"] = "0" * 64
        reject("resealed-outer-with-wrong-member-digest", reseal(header, first.read_bytes(), bad_members))
        unsafe = dict(contents, **{"../escape.txt": b"unsafe"})
        raw_zip, unsafe_members = repack(unsafe)
        reject("resealed-path-traversal", reseal(header, raw_zip, unsafe_members))
        raw_zip, unsafe_members = repack(contents, symlink="profile-result.json")
        reject("resealed-symlink-member", reseal(header, raw_zip, unsafe_members))
        raw_zip, normal_members = repack(contents, extra=("unexpected.txt", b"extra"))
        reject("resealed-extra-unmanifested-member", reseal(header, raw_zip, normal_members))
        foreign = dict(contents)
        foreign["profile-result.json"] = CODEC.canonical({"dataset": "srj24", "sampleNumber": 2})
        raw_zip, foreign_members = repack(foreign)
        reject("resealed-foreign-result-case", reseal(header, raw_zip, foreign_members))
        changed = copy.deepcopy(provenance)
        changed["githubRunId"] = "987654321"
        foreign = dict(contents, **{"profile-provenance.json": CODEC.canonical(changed)})
        raw_zip, foreign_members = repack(foreign)
        reject("resealed-foreign-provenance-run", reseal(header, raw_zip, foreign_members))
        changed = copy.deepcopy(provenance)
        changed["manifest"]["cases"][0]["inputHash"] = "d" * 64
        foreign = dict(contents, **{"profile-provenance.json": CODEC.canonical(changed)})
        raw_zip, foreign_members = repack(foreign)
        reject("resealed-foreign-provenance-input", reseal(header, raw_zip, foreign_members))
        # Refuse source symlinks and pre-existing output instead of replacing evidence.
        (source / "unsafe-link").symlink_to(source / "profile-result.json")
        try:
            CODEC.emit(source, root / "symlink.zip", run_id=RUN, controller_sha=SHA, case=CASE, stream=io.StringIO())
            raise AssertionError("Accepted source symlink")
        except ValueError:
            cases.append("source-symlink-rejected")
        try:
            CODEC.restore(log_of(frames), restored, expected_run_id=RUN, expected_controller_sha=SHA, expected_case=CASE)
            raise AssertionError("Overwrote restored evidence")
        except ValueError:
            assert restored.read_bytes() == first.read_bytes()
            cases.append("existing-output-never-overwritten")
    print(json.dumps({"status": "PASS_FRAMED_ARTIFACT_LOG_DETERMINISTIC_AND_ADVERSARIAL_INTEGRITY", "pureSyntheticOnly": True,
                      "cases": len(cases), "checks": cases, "realBoardRouting": 0}, sort_keys=True))


if __name__ == "__main__":
    main()
