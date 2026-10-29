#!/usr/bin/env python3
"""Read one immutable retained Actions artifact. Never constructs a solver."""
import argparse
import hashlib
import io
import json
import math
import os
import pathlib
import stat
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import zipfile


def require(value, reason):
    if not value:
        raise ValueError(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def canonical_record_sha256(record):
    return digest(json.dumps(record, sort_keys=True, separators=(",", ":"), allow_nan=False).encode())


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api_request(url, token):
    require(urllib.parse.urlparse(url).netloc == "api.github.com" and url.startswith("https://"), "Unexpected API host")
    return urllib.request.Request(url, headers={"Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})


def verify_metadata(metadata, artifact):
    require(metadata["id"] == artifact["artifactId"] and metadata["name"] == artifact["artifactName"], "Artifact identity changed")
    require(metadata["expired"] is False and metadata["size_in_bytes"] == artifact["zipBytes"], "Artifact expiration/size changed")
    require(metadata["digest"] == "sha256:" + artifact["zipSha256"], "Artifact API digest changed")
    require(str(metadata["workflow_run"]["id"]) == artifact["runId"] and
            metadata["workflow_run"]["head_sha"] == artifact["controllerSha"], "Artifact run/source changed")


def fetch_zip(token, artifact):
    base = "https://api.github.com/repos/" + artifact["repository"]
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(api_request(base + "/actions/artifacts/" + str(artifact["artifactId"]), token), timeout=60) as response:
        metadata = json.load(response)
    verify_metadata(metadata, artifact)
    # Also bind the named job to the retained workflow, without running it.
    with opener.open(api_request(base + "/actions/jobs/" + artifact["jobId"], token), timeout=60) as response:
        job = json.load(response)
    require(str(job["id"]) == artifact["jobId"] and str(job["run_id"]) == artifact["runId"] and
            job["head_sha"] == artifact["controllerSha"] and job["status"] == "completed" and
            job["conclusion"] == "success", "Retained job identity/conclusion changed")
    try:
        response = opener.open(api_request(base + "/actions/artifacts/" + str(artifact["artifactId"]) + "/zip", token), timeout=60)
    except urllib.error.HTTPError as error:
        require(error.code in (301, 302, 303, 307, 308), "Artifact redirect unavailable")
        location = error.headers["Location"]
        parsed = urllib.parse.urlparse(location)
        require(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password, "Unsafe artifact redirect")
        # No authentication is forwarded to the signed artifact-storage URL.
        with urllib.request.urlopen(urllib.request.Request(location), timeout=60) as download:
            data = download.read(artifact["zipBytes"] + 1)
    else:
        with response:
            data = response.read(artifact["zipBytes"] + 1)
    require(len(data) == artifact["zipBytes"] and digest(data) == artifact["zipSha256"], "ZIP exact bytes changed")
    return data


def extract_safe(data, destination):
    require(not destination.exists(), "Expected fresh artifact output directory")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        require(len(members) <= 2500 and sum(item.file_size for item in members) <= 250_000_000, "Extraction budget exceeded")
        seen = set()
        for item in members:
            path = pathlib.PurePosixPath(item.filename)
            require(item.filename not in seen and not path.is_absolute() and ".." not in path.parts and
                    "\\" not in item.filename and not stat.S_ISLNK(item.external_attr >> 16), "Unsafe archive member")
            seen.add(item.filename)
        destination.mkdir(parents=True)
        archive.extractall(destination)


def verify_checkpoints(raw, row, case, artifact):
    path = raw / "phase-checkpoints.jsonl"
    lines = path.read_bytes().splitlines()
    require(0 < len(lines) <= 256 and all(len(line) <= 4095 for line in lines), "Checkpoint bounds changed")
    checkpoints = [json.loads(line) for line in lines]
    expected = {"schemaVersion": 1, "campaign": artifact["campaign"], "arm": case["arm"],
        "algorithmSha": case["sourceSha"], "githubRunId": artifact["runId"], "controllerSha": artifact["controllerSha"],
        "dataset": artifact["dataset"], "originalSample": case["sample"], "inputSha256": case["expectedInputHash"],
        "executionOrder": artifact["executionOrder"], "observerSourceSha256": artifact["observerSourceSha256"]}
    previous = -math.inf
    for index, checkpoint in enumerate(checkpoints):
        require(checkpoint["sequence"] == index and all(checkpoint.get(k) == v for k, v in expected.items()), "Checkpoint identity changed")
        stamp = checkpoint["monotonicMs"]
        require(type(stamp) in (int, float) and math.isfinite(stamp) and stamp >= previous, "Checkpoint clock is not monotonic")
        previous = stamp
    status = read_json(raw / "phase-checkpoint-status.json")
    require(status == row["phaseCheckpointAudit"]["status"] and status["errors"] == [] and
            status["truncated"] is False and all(status[k] is True for k in ["installed", "solveEntered", "solveFinished"]), "Checkpoint status changed")
    require(len(checkpoints) == case["checkpointRowCount"] == row["phaseCheckpointAudit"]["rowCount"] == status["rowsWritten"] and
            checkpoints[-1] == case["checkpointTerminal"] == row["phaseCheckpointAudit"]["lastDurableCheckpoint"] and
            checkpoints[-1]["event"] == "solve_exit" and row["phaseCheckpointAudit"]["errors"] == [], "Checkpoint terminal state changed")
    return checkpoints, digest(path.read_bytes())


def lifecycle_diagnostic(checkpoints, row, checkpoint_hash):
    # Consecutive synchronous boundaries include setup, callbacks and observer
    # overhead. They are diagnostic intervals, never pure phase solve clocks.
    phases = {}
    for start, end in zip(checkpoints, checkpoints[1:]):
        phase = start.get("phaseName")
        if phase is None:
            phase = "unassigned_lifecycle"
        interval = end["monotonicMs"] - start["monotonicMs"]
        entry = phases.setdefault(phase, {"lifecycleIntervalMs": 0, "intervalCount": 0, "eventCounts": {}})
        entry["lifecycleIntervalMs"] += interval
        entry["intervalCount"] += 1
        entry["eventCounts"][start["event"]] = entry["eventCounts"].get(start["event"], 0) + 1
    official = row["official"]
    constructor = official["routingMetrics"]["experimentAudit"]["constructorTimeMs"]
    return {"sample": row["sampleNumber"], "arm": row["arm"], "sourceSha": row["sha"],
        "inputSha256": row["expectedInputHash"], "checkpointSha256": checkpoint_hash,
        "constructorPlusOfficialSolveMs": constructor + official["elapsedTimeMs"],
        "lifecycleObservedSpanMs": checkpoints[-1]["monotonicMs"] - checkpoints[0]["monotonicMs"],
        "phaseAssignedLifecycleIntervals": phases,
        "interpretation": "Consecutive unchanged synchronous checkpoint boundaries. Intervals include setup, callbacks and observer work; not pure phase clocks, CPU profiles or proof of where every unobserved operation ran."}


def verify_rows(root, configuration):
    artifact = configuration["artifact"]
    provenance = read_json(root / "provenance.json")
    require(str(provenance["githubRunId"]) == artifact["runId"] and provenance["controllerSha"] == artifact["controllerSha"], "Captured run/controller changed")
    require(all(provenance[k] == artifact[k] for k in ["dataset", "executionOrder", "qualificationMode"]), "Captured dataset/order/population changed")
    require([r["sampleNumber"] for r in provenance["selectedInputPopulation"]] == artifact["population"], "Original population changed")
    expected = {(c["sample"], c["arm"]): c for c in artifact["records"]}
    require(len(expected) == len(artifact["records"]) == 32 and set(expected) == {(s, a) for s in range(1, 17) for a in "AB"}, "Expected full18 identities changed")
    require({key for key, c in expected.items() if c["didSolve"] is False} == {(6, "B"), (13, "B")}, "Native failure population changed")
    rows = [json.loads(line) for line in (root / "results.jsonl").read_text().splitlines() if line]
    require([(r["sampleNumber"], r["arm"]) for r in rows] == [(s, a) for s in range(1, 17) for a in "AB"], "Actual 32 AB identities/order changed")
    receipts, bindings, diagnostics = [], [], []
    for row in rows:
        case = expected[row["sampleNumber"], row["arm"]]
        require(canonical_record_sha256(row) == case["canonicalRecordSha256"], "Full actual strict record bytes/types changed")
        require(row["dataset"] == artifact["dataset"] and row["sha"] == case["sourceSha"] and row["campaign"] == artifact["campaign"] and
                row["round"] == 1 and row["executionOrder"] == artifact["executionOrder"] and row["qualificationMode"] == "full", "Row source/identity changed")
        require(row["expectedInputHash"] == case["expectedInputHash"] == case["observedInputHash"] and
                row["controllerError"] is None and row["supplementalValidationError"] is None, "Row input/controller integrity changed")
        harness = provenance["harnesses"][case["arm"]]
        require(harness["checkoutSha"] == case["sourceSha"] and harness["validators"] == configuration["validatorHashes"], "Captured source/evaluators changed")
        official = row["official"]
        audit = official["routingMetrics"]["experimentAudit"]
        require(all(official[k] == v for k, v in case["officialState"].items()) and
                official.get("errorPhaseName") == case["errorPhaseName"], "Official success/native failure state changed")
        require(audit["options"] == case["options"] and audit["inputHash"] == case["expectedInputHash"] and
                all(audit[k] == v for k, v in case["nativeState"].items()), "Native constructor/failure/input state changed")
        raw = root / "round-1" / ("sample-%03d" % case["sample"]) / case["arm"] / "raw"
        if case["arm"] == "B":
            require(audit["evidence"]["portPointPathingSolver.tinyPipelineSolver.solveGraph.RETAIN_BEST_PARTIAL_ROUTING"] is False and
                    audit["evidence"]["highDensityRouteSolver.viaPlacementContext.layerCount"] == case["layerCount"], "Live candidate retain/guard flags changed")
        checkpoints, checkpoint_hash = verify_checkpoints(raw, row, case, artifact)
        hashes = {"input": case["expectedInputHash"], "output": case["output"], "traces": case["traces"]}
        raw_hashes = {p.name: digest(p.read_bytes()) for p in sorted(raw.iterdir()) if p.is_file()}
        if case["didSolve"]:
            require(official["drcErrorCount"] == 0 and official["relaxedDrcPassed"] is True, "Successful reference state changed")
            for filename, key in [("original-input.json", "input"), ("raw-solver-output.json", "output"), ("raw-new-traces.json", "traces")]:
                require(raw_hashes.get(filename) == hashes[key], "Successful retained raw bytes changed")
            require(audit.get("rawOutputHash") == case["output"] and audit.get("rawNewTracesHash") == case["traces"], "Successful output identity changed")
            supplemental = read_json(raw / "supplemental-validation.json")
            require({k: supplemental[k]["count"] for k in case["supplementalCounts"]} == case["supplementalCounts"], "Captured placement/reference findings changed")
        else:
            require(case["output"] is None and case["traces"] is None and audit.get("rawOutputHash") is None and
                    audit.get("rawNewTracesHash") is None and row["supplemental"] is None, "Failure relabelled as output")
            require(not any((raw / p).exists() for p in ["raw-solver-output.json", "raw-new-traces.json", "capture-provenance.json", "supplemental-validation.json"]), "Invented copper for native failure")
        receipts.append({"sample": case["sample"], "arm": case["arm"], "sourceSha": case["sourceSha"], "options": case["options"],
            "hashes": hashes, "didSolve": case["didSolve"], "didTimeout": case["didTimeout"],
            "nativeFailed": case["nativeState"]["solverFailed"], "errorPhaseName": case["errorPhaseName"],
            "nativeErrorSha256": None if audit["solverError"] is None else digest(audit["solverError"].encode()),
            "rawFileSha256": raw_hashes})
        if case["sample"] in artifact["selectedPlacementSamples"]:
            require(case["didSolve"], "Cannot inspect nonexistent copper")
            bindings.append({"sample": case["sample"], "arm": case["arm"], "sourceSha": case["sourceSha"],
                "rawDirectory": str(raw.resolve()), "campaignDirectory": str(root.resolve()), "expectedHashes": hashes,
                "expectedOptions": case["options"], "rawFileSha256": raw_hashes})
        if case["sample"] in artifact["lifecycleDiagnosticSamples"]:
            diagnostics.append(lifecycle_diagnostic(checkpoints, row, checkpoint_hash))
    return receipts, bindings, diagnostics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    args = parser.parse_args()
    configuration = read_json(args.manifest)
    require(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=args.source, text=True).strip() == configuration["sourceSha"] and
            subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=args.source, text=True).strip() == configuration["sourceTree"], "Audit source checkout changed")
    data = fetch_zip(os.environ["GH_TOKEN"], configuration["artifact"])
    extract_safe(data, args.output)
    matches = list(args.output.rglob("provenance.json"))
    require(len(matches) == 1, "Expected exactly one retained full18 campaign")
    receipts, bindings, diagnostics = verify_rows(matches[0].parent, configuration)
    receipt = {"status": "PASS_ALL32_ACTUAL_IDENTITIES_WITH_B6_B13_NATIVE_FAILURES_AND_NO_INVENTED_OUTPUT", "artifact":
        {k: v for k, v in configuration["artifact"].items() if k not in ["records"]},
        "manifestSha256": digest(args.manifest.read_bytes()), "parsedEvidenceSha256": configuration["parsedEvidenceSha256"],
        "identityLedgerSha256": configuration["identityLedgerSha256"], "records": receipts, "lifecycleDiagnostics": diagnostics}
    receipt_path = args.output / "offline-identity-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    (args.output / "placement-bindings.json").write_text(json.dumps({"configuration": configuration, "bindings": bindings,
        "strictQualificationReceipt": {"path": str(receipt_path.resolve()), "sha256": digest(receipt_path.read_bytes())}}, indent=2) + "\n")
    print("FULL18_OFFLINE_IDENTITY_JSON " + json.dumps(receipt, separators=(",", ":")))


if __name__ == "__main__":
    main()
