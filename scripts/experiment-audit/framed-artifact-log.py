#!/usr/bin/env python3
"""Exact profile ZIP transport through authenticated GitHub job-log text."""
import argparse
import base64
import hashlib
import io
import json
import math
import os
import pathlib
import re
import stat
import sys
import tempfile
import zipfile

PREFIX = "BOTTLENECK_ARTIFACT "
CHUNK = 8192
MAX_ZIP_BYTES = 32 * 1024 * 1024
MAX_MEMBER_BYTES = 256 * 1024 * 1024
MAX_MEMBERS = 2048
FRAME_LINE = re.compile(r"^\ufeff?(?:\d{4}-\d{2}-\d{2}T\S+Z\s+)?" + re.escape(PREFIX) + r"(.*)$")


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON key")
        result[key] = value
    return result


def parse_json(value):
    return json.loads(value, object_pairs_hook=unique_object)


def identity(run_id, controller_sha, case):
    require(isinstance(run_id, str) and re.fullmatch(r"[1-9][0-9]*", run_id), "Invalid GitHub run ID")
    require(isinstance(controller_sha, str) and re.fullmatch(r"[0-9a-f]{40}", controller_sha), "Invalid controller SHA")
    require(isinstance(case, str) and re.fullmatch(r"srj(?:18|24):[1-9][0-9]*", case), "Invalid profile case")
    dataset, sample = case.split(":")
    require(int(sample) <= {"srj18": 16, "srj24": 26}[dataset], "Profile case outside original population")
    return dataset, int(sample)


def safe_name(name):
    require(isinstance(name, str) and 0 < len(name) <= 1024, "Invalid ZIP member name")
    require("\\" not in name and "\x00" not in name and ":" not in name, "Unsafe ZIP member name")
    path = pathlib.PurePosixPath(name)
    require(not path.is_absolute() and all(part not in ("", ".", "..") for part in name.split("/")), "Unsafe ZIP member path")
    require(path.as_posix() == name, "Noncanonical ZIP member path")
    return name


def profile_binding(contents, run_id, controller_sha, case):
    dataset, sample = identity(run_id, controller_sha, case)
    require("profile-provenance.json" in contents, "Missing profile provenance")
    provenance = parse_json(contents["profile-provenance.json"])
    require(provenance.get("githubRunId") == run_id, "Foreign provenance run")
    require(provenance.get("controllerSha") == controller_sha, "Foreign provenance controller")
    observed = provenance.get("inputIdentity", {})
    require(observed.get("sampleNumber") == sample, "Foreign provenance sample")
    if "dataset" in observed:
        require(observed["dataset"] == dataset, "Foreign provenance dataset")
    selected = [item for item in provenance.get("manifest", {}).get("cases", [])
                if item.get("dataset") == dataset and item.get("sample") == sample]
    require(len(selected) == 1 and re.fullmatch(r"[0-9a-f]{64}", str(observed.get("inputHash", ""))), "Missing exact profile input identity")
    require(selected[0].get("inputHash") == observed["inputHash"], "Foreign provenance input")
    if "profile-result.json" in contents:
        record = parse_json(contents["profile-result.json"])
        require(record.get("dataset") == dataset and record.get("sampleNumber") == sample, "Foreign profile result case")
        if "expectedInputHash" in record:
            require(record["expectedInputHash"] == observed["inputHash"], "Foreign profile result input")
    return {"dataset": dataset, "sample": sample, "inputHash": observed["inputHash"]}


def chunk_count(size):
    return math.ceil((4 * math.ceil(size / 3)) / CHUNK)


def emit(directory, archive, *, run_id, controller_sha, case, stream=None):
    stream = sys.stdout if stream is None else stream
    identity(run_id, controller_sha, case)
    directory, archive = pathlib.Path(directory).resolve(), pathlib.Path(archive).resolve()
    require(directory.is_dir(), "Profile result directory does not exist")
    require(not archive.exists(), "Never overwrite an existing transport ZIP")
    paths = sorted(directory.rglob("*"))
    require(all(not path.is_symlink() for path in paths), "Symlinks are forbidden in profile evidence")
    contents = {}
    total = 0
    for path in paths:
        if path.is_dir():
            continue
        require(path.is_file(), "Unsupported profile evidence entry")
        name = safe_name(path.relative_to(directory).as_posix())
        total += path.stat().st_size
        require(total <= MAX_MEMBER_BYTES and len(contents) < MAX_MEMBERS, "Profile evidence exceeds transport bounds")
        contents[name] = path.read_bytes()
    require(contents, "Empty profile result directory")
    profile_binding(contents, run_id, controller_sha, case)
    members = [{"path": name, "bytes": len(raw), "sha256": digest(raw)} for name, raw in contents.items()]
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
        for name, raw in contents.items():
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            target.writestr(info, raw, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    raw_zip = payload.getvalue()
    require(len(raw_zip) <= MAX_ZIP_BYTES, "ZIP exceeds 32MiB log transport cap")
    manifest = canonical(members)
    header = {"kind": "begin", "version": 1, "run_id": run_id, "controller_sha": controller_sha, "case": case,
              "zip_bytes": len(raw_zip), "zip_sha256": digest(raw_zip), "zip_chunks": chunk_count(len(raw_zip)),
              "manifest_bytes": len(manifest), "manifest_sha256": digest(manifest),
              "manifest_chunks": chunk_count(len(manifest)), "member_count": len(members), "chunk_chars": CHUNK}
    archive.parent.mkdir(parents=True, exist_ok=True)
    with archive.open("xb") as output:
        output.write(raw_zip)
    def line(value):
        stream.write(PREFIX + canonical(value).decode("ascii") + "\n")
    line(header)
    for kind, raw in [("manifest", manifest), ("zip", raw_zip)]:
        encoded = base64.b64encode(raw).decode("ascii")
        for seq, start in enumerate(range(0, len(encoded), CHUNK)):
            line({"kind": kind, "seq": seq, "data": encoded[start:start + CHUNK]})
    line({"kind": "end", "run_id": run_id, "controller_sha": controller_sha, "case": case,
          "zip_sha256": header["zip_sha256"], "manifest_sha256": header["manifest_sha256"],
          "zip_chunks": header["zip_chunks"], "manifest_chunks": header["manifest_chunks"]})
    stream.flush()
    return header


def restore(log_text, archive_path, *, expected_run_id, expected_controller_sha, expected_case):
    identity(expected_run_id, expected_controller_sha, expected_case)
    header, ended = None, False
    chunks = {"manifest": [], "zip": []}
    for line in log_text.splitlines():
        match = FRAME_LINE.fullmatch(line)
        if not match:
            continue
        frame = parse_json(match[1])
        require(isinstance(frame, dict), "Invalid framed record")
        kind = frame.get("kind")
        if header is None:
            require(kind == "begin", "Missing archive begin frame")
            required = {"kind", "version", "run_id", "controller_sha", "case", "zip_bytes", "zip_sha256", "zip_chunks", "manifest_bytes", "manifest_sha256", "manifest_chunks", "member_count", "chunk_chars"}
            require(set(frame) == required and frame["version"] == 1 and frame["chunk_chars"] == CHUNK, "Unsupported archive header")
            require((frame["run_id"], frame["controller_sha"], frame["case"]) == (expected_run_id, expected_controller_sha, expected_case), "Foreign archive identity")
            for field, cap in [("zip_bytes", MAX_ZIP_BYTES), ("manifest_bytes", 4 * 1024 * 1024), ("member_count", MAX_MEMBERS)]:
                require(type(frame[field]) is int and 0 < frame[field] <= cap, "Archive size exceeds bounds")
            for label in ["zip", "manifest"]:
                require(re.fullmatch(r"[0-9a-f]{64}", str(frame[label + "_sha256"])), "Invalid archive digest")
                require(type(frame[label + "_chunks"]) is int and frame[label + "_chunks"] == chunk_count(frame[label + "_bytes"]), "Invalid archive chunk count")
            header = frame
            continue
        require(not ended, "Unexpected frame after end marker")
        if kind in chunks:
            require(set(frame) == {"kind", "seq", "data"}, "Invalid data frame fields")
            require(type(frame["seq"]) is int and frame["seq"] == len(chunks[kind]), "Duplicate or out-of-order archive chunk")
            require(len(chunks[kind]) < header[kind + "_chunks"], "Extra archive chunk")
            if kind == "manifest":
                require(not chunks["zip"], "Manifest follows ZIP data")
            else:
                require(len(chunks["manifest"]) == header["manifest_chunks"], "ZIP precedes complete manifest")
            value = frame["data"]
            require(isinstance(value, str) and 0 < len(value) <= CHUNK, "Invalid archive data chunk")
            if frame["seq"] < header[kind + "_chunks"] - 1:
                require(len(value) == CHUNK, "Short interior archive chunk")
            raw = base64.b64decode(value, validate=True)
            require(base64.b64encode(raw).decode("ascii") == value, "Noncanonical base64 data")
            chunks[kind].append(value)
        elif kind == "end":
            expected = {"kind": "end", "run_id": expected_run_id, "controller_sha": expected_controller_sha,
                        "case": expected_case, "zip_sha256": header["zip_sha256"],
                        "manifest_sha256": header["manifest_sha256"], "zip_chunks": header["zip_chunks"],
                        "manifest_chunks": header["manifest_chunks"]}
            require(frame == expected, "Foreign archive end marker")
            require(all(len(chunks[key]) == header[key + "_chunks"] for key in chunks), "Truncated archive chunks")
            ended = True
        else:
            raise ValueError("Unknown or duplicate archive frame")
    require(header is not None and ended, "Missing complete archive end marker")
    decoded = {key: base64.b64decode("".join(value), validate=True) for key, value in chunks.items()}
    for key, raw in decoded.items():
        require(len(raw) == header[key + "_bytes"] and digest(raw) == header[key + "_sha256"], "Archive bytes or SHA256 mismatch")
    members = parse_json(decoded["manifest"])
    require(isinstance(members, list) and len(members) == header["member_count"], "Invalid member manifest")
    names = []
    total = 0
    for member in members:
        require(isinstance(member, dict) and set(member) == {"path", "bytes", "sha256"}, "Invalid member manifest fields")
        names.append(safe_name(member["path"]))
        require(type(member["bytes"]) is int and 0 <= member["bytes"] <= MAX_MEMBER_BYTES, "Member exceeds bounds")
        require(re.fullmatch(r"[0-9a-f]{64}", str(member["sha256"])), "Invalid member digest")
        total += member["bytes"]
    require(names == sorted(set(names)) and total <= MAX_MEMBER_BYTES, "Duplicate/unsorted members or inflated archive")
    contents = {}
    with zipfile.ZipFile(io.BytesIO(decoded["zip"])) as zipped:
        entries = zipped.infolist()
        require([entry.filename for entry in entries] == names, "ZIP and member manifest differ")
        for entry, member in zip(entries, members):
            mode = entry.external_attr >> 16
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG) and not entry.is_dir(), "ZIP member is not a regular file")
            require(not (entry.flag_bits & 1) and entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), "Unsupported ZIP encoding")
            require(entry.file_size == member["bytes"], "ZIP member size mismatch")
            raw = zipped.read(entry)
            require(len(raw) == member["bytes"] and digest(raw) == member["sha256"], "ZIP member bytes or SHA256 mismatch")
            contents[entry.filename] = raw
    binding = profile_binding(contents, expected_run_id, expected_controller_sha, expected_case)
    archive_path = pathlib.Path(archive_path)
    require(not archive_path.exists(), "Never overwrite restored evidence")
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=archive_path.parent, delete=False) as output:
            temporary = pathlib.Path(output.name)
            output.write(decoded["zip"])
        os.link(temporary, archive_path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return {"status": "PASS_AUTHENTICATED_LOG_ARCHIVE_BYTE_AND_MEMBER_BINDING", "archive": str(archive_path),
            "zip_sha256": header["zip_sha256"], "zip_bytes": header["zip_bytes"],
            "member_manifest_sha256": header["manifest_sha256"], "members": members, "profile_identity": binding,
            "run_id": expected_run_id, "controller_sha": expected_controller_sha, "case": expected_case}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    sender = commands.add_parser("emit")
    sender.add_argument("--directory", type=pathlib.Path, required=True)
    sender.add_argument("--archive", type=pathlib.Path, required=True)
    sender.add_argument("--case", required=True)
    sender.add_argument("--run-id", default=os.environ.get("GITHUB_RUN_ID"))
    sender.add_argument("--controller-sha", default=os.environ.get("GITHUB_SHA"))
    receiver = commands.add_parser("restore")
    receiver.add_argument("--log", type=pathlib.Path, required=True)
    receiver.add_argument("--archive", type=pathlib.Path, required=True)
    receiver.add_argument("--case", required=True)
    receiver.add_argument("--run-id", required=True)
    receiver.add_argument("--controller-sha", required=True)
    args = parser.parse_args()
    if args.command == "emit":
        emit(args.directory, args.archive, run_id=args.run_id, controller_sha=args.controller_sha, case=args.case)
    else:
        result = restore(args.log.read_text(encoding="utf-8"), args.archive, expected_run_id=args.run_id,
                         expected_controller_sha=args.controller_sha, expected_case=args.case)
        print(json.dumps(result, sort_keys=True))
