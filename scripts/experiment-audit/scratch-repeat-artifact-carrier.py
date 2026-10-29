#!/usr/bin/env python3
"""Carry exact original GitHub artifact ZIP bytes in bounded authenticated job logs."""
import argparse
import base64
import hashlib
import json
import math
import os
import pathlib
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = "tscircuit/tscircuit-autorouter"
WORKFLOW = ".github/workflows/scratch-repeat.yml"
PART_BYTES = 1024 * 1024
CHUNK_CHARS = 8192
MAX_ZIP_BYTES = 256 * PART_BYTES
MAX_JOBS = 256
PREFIX = "SCRATCH_REPEAT_ARTIFACT_SEGMENT "
NAME = re.compile(r"^scratch-repeat-raw-(repair-search-scratch)-(srj18|srj24)-(BALANCED)$")
FRAME = re.compile(r"^\ufeff?(?:\d{4}-\d{2}-\d{2}T\S+Z\s+)?" + re.escape(PREFIX) + r"(.*)$")
SPEC_FIELDS = {"version", "repository", "source_run_id", "controller_sha", "run_attempt", "manifest_sha256",
               "artifact_id", "artifact_name", "feature", "dataset", "order", "part_index", "part_count",
               "offset", "segment_bytes", "whole_bytes", "whole_sha256", "job_name"}


def require(value, message):
    if not value:
        raise ValueError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, "Duplicate JSON key")
        value[key] = item
    return value


def parse_json(raw):
    return json.loads(raw, object_pairs_hook=unique_object)


def integer(value, minimum=0, maximum=None):
    return type(value) is int and value >= minimum and (maximum is None or value <= maximum)


def digest(value, length=64):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{" + str(length) + "}", value) is not None


def job_name(artifact_id, part_index):
    return f"scratch-repeat-artifact-carrier / {artifact_id} / {part_index}"


def run_pin(metadata, *, run_id, controller_sha, repository):
    require(repository == REPOSITORY, "Unexpected repository")
    require(isinstance(run_id, str) and re.fullmatch(r"[1-9][0-9]*", run_id), "Invalid source run ID")
    require(digest(controller_sha, 40), "Invalid controller SHA")
    require(integer(metadata.get("id"), 1) and str(metadata["id"]) == run_id, "Foreign source run metadata")
    require(metadata.get("head_sha") == controller_sha, "Foreign source controller metadata")
    require(metadata.get("path") == WORKFLOW, "Foreign source workflow")
    repo = metadata.get("repository", {})
    require(repo.get("full_name") == repository and integer(repo.get("id"), 1), "Foreign source repository")
    require(integer(metadata.get("run_attempt"), 1), "Missing source run attempt")
    return {"source_run_id": run_id, "controller_sha": controller_sha, "repository": repository,
            "repository_id": repo["id"], "run_attempt": metadata["run_attempt"]}


def artifact_pin(metadata, source):
    require(isinstance(metadata, dict), "Invalid artifact metadata")
    require(integer(metadata.get("id"), 1), "Invalid artifact ID")
    match = NAME.fullmatch(str(metadata.get("name", "")))
    require(match is not None, "Unexpected raw artifact name")
    require(integer(metadata.get("size_in_bytes"), 1, MAX_ZIP_BYTES), "Artifact ZIP size exceeds bounds")
    require(metadata.get("expired") is False, "Artifact is expired or expiry unknown")
    value = metadata.get("digest")
    require(isinstance(value, str) and value.startswith("sha256:") and digest(value[7:]), "Missing original server ZIP digest")
    lineage = metadata.get("workflow_run", {})
    require(integer(lineage.get("id"), 1) and str(lineage["id"]) == source["source_run_id"], "Foreign artifact run")
    require(lineage.get("head_sha") == source["controller_sha"], "Foreign artifact controller")
    require(lineage.get("repository_id") == source["repository_id"] and lineage.get("head_repository_id") == source["repository_id"], "Foreign artifact repository")
    return {"artifact_id": metadata["id"], "artifact_name": metadata["name"],
            "whole_bytes": metadata["size_in_bytes"], "whole_sha256": value[7:],
            "feature": match[1], "dataset": match[2], "order": match[3]}


def make_spec(artifact, source, manifest_sha256, part_index):
    require(digest(manifest_sha256), "Invalid manifest digest")
    count = (artifact["whole_bytes"] + PART_BYTES - 1) // PART_BYTES
    require(integer(part_index, 0, count - 1), "Invalid part index")
    return {"version": 1, "repository": source["repository"], "source_run_id": source["source_run_id"],
            "controller_sha": source["controller_sha"], "run_attempt": source["run_attempt"],
            "manifest_sha256": manifest_sha256, **artifact, "part_index": part_index, "part_count": count,
            "offset": part_index * PART_BYTES, "segment_bytes": min(PART_BYTES, artifact["whole_bytes"] - part_index * PART_BYTES),
            "job_name": job_name(artifact["artifact_id"], part_index)}


def validate_spec(spec):
    require(isinstance(spec, dict) and set(spec) == SPEC_FIELDS, "Unexpected carrier spec fields")
    require(type(spec["version"]) is int and spec["version"] == 1, "Invalid carrier version")
    require(spec["repository"] == REPOSITORY, "Foreign carrier repository")
    require(isinstance(spec["source_run_id"], str) and re.fullmatch(r"[1-9][0-9]*", spec["source_run_id"]), "Invalid carrier run ID")
    require(digest(spec["controller_sha"], 40) and digest(spec["manifest_sha256"]) and digest(spec["whole_sha256"]), "Invalid carrier digest")
    for field in ["run_attempt", "artifact_id", "whole_bytes", "part_count", "segment_bytes"]:
        require(integer(spec[field], 1), "Invalid positive carrier integer")
    require(spec["whole_bytes"] <= MAX_ZIP_BYTES and spec["part_count"] <= MAX_JOBS, "Carrier exceeds bounds")
    require(integer(spec["part_index"]) and integer(spec["offset"]), "Invalid carrier offset/index")
    match = NAME.fullmatch(spec["artifact_name"])
    require(match and (spec["feature"], spec["dataset"], spec["order"]) == match.groups(), "Carrier artifact scope mismatch")
    count = (spec["whole_bytes"] + PART_BYTES - 1) // PART_BYTES
    require(spec["part_count"] == count and spec["part_index"] < count, "Carrier part count/index mismatch")
    require(spec["offset"] == spec["part_index"] * PART_BYTES, "Carrier part offset mismatch")
    require(spec["segment_bytes"] == min(PART_BYTES, spec["whole_bytes"] - spec["offset"]), "Carrier final part size mismatch")
    require(spec["job_name"] == job_name(spec["artifact_id"], spec["part_index"]), "Carrier job name mismatch")
    return spec


def plan(manifest, *, run_id, controller_sha, repository, manifest_sha256, api_get):
    require(manifest.get("repository") == repository == REPOSITORY, "Manifest repository mismatch")
    require(manifest.get("campaign") == "scratch-repeat16-20261029", "Wrong repeated timing campaign")
    require(manifest.get("pairOrders") == ["AB", "BA", "BA", "AB"], "Wrong balanced order sequence")
    require([(item.get("dataset"), item.get("sample")) for item in manifest.get("cases", [])] == [("srj18", 14), ("srj24", 2)], "Wrong selected case population")
    require(type(manifest.get("plannedJobs")) is int and manifest["plannedJobs"] == 2 and type(manifest.get("plannedAttempts")) is int and manifest["plannedAttempts"] == 16, "Wrong repeated population")
    candidate = manifest.get("candidate", {})
    require(candidate.get("id") == "repair-search-scratch" and digest(candidate.get("candidateSha"), 40) and digest(candidate.get("candidateTree"), 40), "Unsealed scratch source")
    require(manifest.get("uniqueBoardDenominatorIncrease") is False and manifest.get("correctedClocks") is False, "Repeated timing scope changed")
    source = run_pin(api_get(f"/repos/{repository}/actions/runs/{run_id}"), run_id=run_id, controller_sha=controller_sha, repository=repository)
    artifacts, total = [], None
    for page in range(1, 12):
        data = api_get(f"/repos/{repository}/actions/runs/{run_id}/artifacts?per_page=100&page={page}")
        require(integer(data.get("total_count"), 0, 1000), "Artifact listing size is invalid")
        if total is None:
            total = data["total_count"]
        require(data["total_count"] == total and isinstance(data.get("artifacts"), list) and len(data["artifacts"]) <= 100, "Artifact listing changed during pagination")
        artifacts.extend(data["artifacts"])
        if len(artifacts) >= total:
            break
        require(data["artifacts"], "Truncated artifact listing")
    require(len(artifacts) == total, "Incomplete paginated artifact listing")
    expected = [f"scratch-repeat-raw-repair-search-scratch-{dataset}-BALANCED" for dataset in ["srj18", "srj24"]]
    raw = [item for item in artifacts if str(item.get("name", "")).startswith("scratch-repeat-raw-")]
    require(len(raw) == len(expected) and {item["name"] for item in raw} == set(expected), "Missing, duplicate, or unexpected raw artifacts")
    by_name = {item["name"]: item for item in raw}
    pins = [artifact_pin(by_name[name], source) for name in expected]
    require(len({item["artifact_id"] for item in pins}) == len(pins), "Duplicate artifact IDs")
    specs = [make_spec(item, source, manifest_sha256, index) for item in pins
             for index in range((item["whole_bytes"] + PART_BYTES - 1) // PART_BYTES)]
    require(0 < len(specs) <= MAX_JOBS, "Carrier matrix exceeds 256 jobs; no partial matrix is allowed")
    matrix = {"include": specs}
    require(len(canonical(matrix)) * 2 < 950000, "Carrier matrix exceeds GitHub output bounds")
    return {"matrix": matrix, "artifact_pins": pins, "run_pin": source, "manifest_sha256": manifest_sha256, "carrier_jobs": len(specs)}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHubClient:
    def __init__(self, token, opener=None):
        require(isinstance(token, str) and token, "GITHUB_TOKEN is required")
        self.token = token
        self.opener = opener or urllib.request.build_opener(NoRedirect())

    def api_get(self, path):
        require(path.startswith(f"/repos/{REPOSITORY}/actions/") and not path.startswith("//"), "Unapproved GitHub API path")
        request = urllib.request.Request("https://api.github.com" + path, headers={
            "Authorization": "Bearer " + self.token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
        try:
            with self.opener.open(request, timeout=120) as response:
                require(response.status == 200, "GitHub API JSON response is not successful")
                raw = response.read(4 * PART_BYTES + 1)
        except (urllib.error.HTTPError, urllib.error.URLError):
            raise ValueError("GitHub API metadata request failed") from None
        require(len(raw) <= 4 * PART_BYTES, "GitHub metadata exceeds bounds")
        return parse_json(raw)

    def download(self, artifact_id, expected_size):
        require(integer(artifact_id, 1) and integer(expected_size, 1, MAX_ZIP_BYTES), "Invalid artifact download request")
        url = f"https://api.github.com/repos/{REPOSITORY}/actions/artifacts/{artifact_id}/zip"
        headers = {"Authorization": "Bearer " + self.token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        for redirect in range(5):
            request = urllib.request.Request(url, headers=headers)
            try:
                response = self.opener.open(request, timeout=120)
            except urllib.error.HTTPError as error:
                if error.code not in (301, 302, 303, 307, 308):
                    raise ValueError("GitHub artifact request failed") from None
                location = error.headers.get("Location")
                error.close()
                require(isinstance(location, str), "Artifact redirect has no location")
                parsed = urllib.parse.urlsplit(location)
                require(parsed.scheme == "https" and parsed.username is None and parsed.password is None and parsed.port in (None, 443), "Unsafe artifact redirect")
                host = parsed.hostname or ""
                official = re.fullmatch(r"productionresultssa[0-9]+\.blob\.core\.windows\.net", host) or re.fullmatch(r"[a-z0-9.-]+\.actions\.githubusercontent\.com", host) or host == "github-cloud.s3.amazonaws.com"
                require(official, "Artifact redirect is not an approved GitHub artifact host")
                url = location
                # A new request, with no Authorization or API headers, follows signed redirects.
                headers = {"Accept": "application/zip", "Accept-Encoding": "identity"}
                continue
            except urllib.error.URLError:
                raise ValueError("Artifact storage request failed") from None
            with response:
                require(response.status == 200, "Artifact download is not successful")
                chunks, count = [], 0
                while True:
                    chunk = response.read(min(PART_BYTES, expected_size - count + 1))
                    if not chunk:
                        break
                    count += len(chunk)
                    require(count <= expected_size, "Artifact body exceeds authenticated size")
                    chunks.append(chunk)
                require(count == expected_size, "Truncated original server ZIP")
                return b"".join(chunks)
        raise ValueError("Too many artifact redirects")


def emit_segment(spec, zip_bytes, stream=None):
    validate_spec(spec)
    stream = sys.stdout if stream is None else stream
    require(len(zip_bytes) == spec["whole_bytes"] and sha(zip_bytes) == spec["whole_sha256"], "Original server ZIP bytes do not match authenticated digest")
    segment = zip_bytes[spec["offset"]:spec["offset"] + spec["segment_bytes"]]
    encoded = base64.b64encode(segment).decode("ascii")
    chunks = math.ceil(len(encoded) / CHUNK_CHARS)
    def line(value):
        stream.write(PREFIX + canonical(value).decode("ascii") + "\n")
    line({"kind": "begin", "spec": spec, "segment_sha256": sha(segment), "chunk_chars": CHUNK_CHARS, "chunks": chunks})
    for seq, start in enumerate(range(0, len(encoded), CHUNK_CHARS)):
        line({"kind": "data", "seq": seq, "data": encoded[start:start + CHUNK_CHARS]})
    line({"kind": "end", "artifact_id": spec["artifact_id"], "part_index": spec["part_index"],
          "whole_sha256": spec["whole_sha256"], "segment_sha256": sha(segment), "chunks": chunks})
    stream.flush()
    return {"spec": spec, "segment_sha256": sha(segment), "chunks": chunks}


def carry(spec, *, repository, client, stream=None):
    validate_spec(spec)
    require(repository == spec["repository"] == REPOSITORY, "Carrier repository mismatch")
    source = run_pin(client.api_get(f"/repos/{repository}/actions/runs/{spec['source_run_id']}"),
                     run_id=spec["source_run_id"], controller_sha=spec["controller_sha"], repository=repository)
    require(source["run_attempt"] == spec["run_attempt"], "Carrier source attempt changed")
    artifact = artifact_pin(client.api_get(f"/repos/{repository}/actions/artifacts/{spec['artifact_id']}"), source)
    require(make_spec(artifact, source, spec["manifest_sha256"], spec["part_index"]) == spec, "Carrier artifact metadata changed")
    return emit_segment(spec, client.download(spec["artifact_id"], spec["whole_bytes"]), stream)


def decode_segment(log_text, expected_spec):
    validate_spec(expected_spec)
    begin, ended, values = None, False, []
    for text in log_text.splitlines():
        match = FRAME.fullmatch(text)
        if not match:
            continue
        frame = parse_json(match[1])
        require(isinstance(frame, dict), "Invalid segment frame")
        kind = frame.get("kind")
        if begin is None:
            require(set(frame) == {"kind", "spec", "segment_sha256", "chunk_chars", "chunks"} and kind == "begin", "Missing segment begin")
            validate_spec(frame["spec"])
            require(frame["spec"] == expected_spec, "Foreign segment identity")
            require(digest(frame["segment_sha256"]) and type(frame["chunk_chars"]) is int and frame["chunk_chars"] == CHUNK_CHARS, "Invalid segment header")
            count = math.ceil((4 * math.ceil(expected_spec["segment_bytes"] / 3)) / CHUNK_CHARS)
            require(type(frame["chunks"]) is int and frame["chunks"] == count, "Invalid segment chunk count")
            begin = frame
            continue
        require(not ended, "Replayed segment after end marker")
        if kind == "data":
            require(set(frame) == {"kind", "seq", "data"} and type(frame["seq"]) is int and frame["seq"] == len(values), "Duplicate or out-of-order segment chunk")
            require(len(values) < begin["chunks"], "Extra segment data")
            encoded = frame["data"]
            require(isinstance(encoded, str) and 0 < len(encoded) <= CHUNK_CHARS, "Invalid segment data size")
            if len(values) < begin["chunks"] - 1:
                require(len(encoded) == CHUNK_CHARS, "Short interior segment chunk")
            raw = base64.b64decode(encoded, validate=True)
            require(base64.b64encode(raw).decode("ascii") == encoded, "Noncanonical segment base64")
            values.append(raw)
        elif kind == "end":
            require(frame == {"kind": "end", "artifact_id": expected_spec["artifact_id"], "part_index": expected_spec["part_index"],
                              "whole_sha256": expected_spec["whole_sha256"], "segment_sha256": begin["segment_sha256"], "chunks": begin["chunks"]}, "Foreign segment end marker")
            require(len(values) == begin["chunks"], "Truncated segment data")
            ended = True
        else:
            raise ValueError("Unknown or duplicate segment frame")
    require(begin is not None and ended, "Missing complete segment end marker")
    segment = b"".join(values)
    require(len(segment) == expected_spec["segment_bytes"] and sha(segment) == begin["segment_sha256"], "Segment digest/size mismatch")
    return segment


def restore(log_records, archive_path, *, expected_artifact, expected_run, expected_jobs,
            expected_manifest_sha256, repository=REPOSITORY):
    source = run_pin(expected_run, run_id=str(expected_run.get("id")), controller_sha=expected_run.get("head_sha"), repository=repository)
    artifact = artifact_pin(expected_artifact, source)
    require(digest(expected_manifest_sha256), "External manifest pin is required")
    count = (artifact["whole_bytes"] + PART_BYTES - 1) // PART_BYTES
    require(isinstance(expected_jobs, list) and len(expected_jobs) == count, "Explicit selected carrier job population is incomplete")
    expected_names = {job_name(artifact["artifact_id"], index): index for index in range(count)}
    selected, parts = {}, set()
    for job in expected_jobs:
        require(isinstance(job, dict) and integer(job.get("id"), 1) and job["id"] not in selected, "Duplicate or invalid selected job ID")
        require(str(job.get("run_id")) == source["source_run_id"] and job.get("head_sha") == source["controller_sha"], "Foreign selected carrier job run/head")
        require(type(job.get("run_attempt")) is int and job["run_attempt"] == source["run_attempt"], "Foreign selected carrier job attempt")
        require(job.get("status") == "completed" and job.get("conclusion") == "success", "Selected carrier job is not successful")
        require(job.get("name") in expected_names, "Selected carrier job has foreign part name")
        part = expected_names[job["name"]]
        require(part not in parts, "Duplicate/replayed carrier part jobs")
        parts.add(part)
        selected[job["id"]] = (part, job)
    require(parts == set(range(count)), "Missing selected carrier parts")
    require(isinstance(log_records, list) and len(log_records) == count, "Carrier log population incomplete")
    ids = [item.get("job_id") for item in log_records if isinstance(item, dict)]
    require(len(ids) == count and all(integer(item, 1) for item in ids) and len(set(ids)) == count and set(ids) == set(selected), "Duplicate, foreign or missing carrier logs")
    archive_path = pathlib.Path(archive_path)
    require(not archive_path.exists(), "Never overwrite an original server ZIP")
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    temporary, receipts = None, []
    try:
        with tempfile.NamedTemporaryFile(dir=archive_path.parent, delete=False) as output:
            temporary = pathlib.Path(output.name)
            output.truncate(artifact["whole_bytes"])
            for record in log_records:
                require(set(record) == {"job_id", "text"} and isinstance(record["text"], str), "Invalid authenticated log record")
                part, job = selected[record["job_id"]]
                spec = make_spec(artifact, source, expected_manifest_sha256, part)
                segment = decode_segment(record["text"], spec)
                output.seek(spec["offset"])
                output.write(segment)
                receipts.append({"part_index": part, "job_id": job["id"], "run_attempt": job["run_attempt"],
                                 "offset": spec["offset"], "segment_bytes": len(segment), "segment_sha256": sha(segment),
                                 "authenticated_log_sha256": sha(record["text"].encode("utf-8"))})
        whole = hashlib.sha256()
        with temporary.open("rb") as source_file:
            for chunk in iter(lambda: source_file.read(PART_BYTES), b""):
                whole.update(chunk)
        require(temporary.stat().st_size == artifact["whole_bytes"] and whole.hexdigest() == artifact["whole_sha256"], "Restored original server ZIP digest mismatch")
        os.link(temporary, archive_path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return {"status": "PASS_ORIGINAL_SERVER_ZIP_FROM_EXTERNALLY_PINNED_AUTHENTICATED_CARRIER_JOBS", "archive_path": str(archive_path),
            "repository": repository, "source_run_id": source["source_run_id"], "controller_sha": source["controller_sha"],
            "run_attempt": source["run_attempt"], "manifest_sha256": expected_manifest_sha256, **artifact,
            "parts": sorted(receipts, key=lambda value: value["part_index"]), "archiveRepackedOrExtracted": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    planner = commands.add_parser("plan")
    planner.add_argument("--manifest", type=pathlib.Path, required=True)
    planner.add_argument("--run-id", required=True)
    planner.add_argument("--controller-sha", required=True)
    planner.add_argument("--repository", default=REPOSITORY)
    sender = commands.add_parser("carry")
    sender.add_argument("--spec-json", default=os.environ.get("CARRIER_SPEC_JSON"))
    sender.add_argument("--repository", default=REPOSITORY)
    args = parser.parse_args()
    client = GitHubClient(os.environ.get("GITHUB_TOKEN"))
    if args.command == "plan":
        raw = args.manifest.read_bytes()
        result = plan(parse_json(raw), run_id=args.run_id, controller_sha=args.controller_sha,
                      repository=args.repository, manifest_sha256=sha(raw), api_get=client.api_get)
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                output.write("matrix=" + canonical(result["matrix"]).decode("ascii") + "\ncount=" + str(result["carrier_jobs"]) + "\n")
        summary = {key: value for key, value in result.items() if key != "matrix"}
        print("BOTTLENECK_CARRIER_PLAN_JSON " + canonical(summary).decode("ascii"), flush=True)
    else:
        require(isinstance(args.spec_json, str), "CARRIER_SPEC_JSON is required")
        carry(parse_json(args.spec_json), repository=args.repository, client=client)
