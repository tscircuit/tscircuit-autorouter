#!/usr/bin/env python3
"""Read-only audit of an existing public Actions artifact; never reroutes a board."""
import argparse
import hashlib
import io
import json
import os
import pathlib
import stat
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPOSITORY = "tscircuit/tscircuit-autorouter"
RUN_ID = 40752626904
ARTIFACT_ID = 12844383229
ARTIFACT_NAME = "strongest-refinement-fixed-source-retention-off-vs-on-screen-AB-srj18"
ZIP_SHA256 = "c7c348b7818004852905e40cbbfeaccf4ad94393df97d1e68f97d059ed8bbb90"
CONTROLLER_SHA = "6d28137e8f8725cde18e156cbf986892615d25fb"
SOURCE_SHA = "74de6cea4bd39c9aa41e9d492b003a892abd1596"
SOURCE_TREE = "b0de925b8f718415f961f4f9dad146784bbf2b9e"
CAMPAIGN = "fixed-source-retention-off-vs-on"
EXPECTED_INPUT = {
    14: "4a513349694b8558e159dfc88eda8344f1b6158c63f89f558a9cc8c2fa0bf71e",
    15: "29888a7ecc6fa589e1ff0bfb24187c086cfceb2246756ec5bdf69d4bc4d5f6df",
}
EXPECTED_RAW = {
    (14, "A"): ("f806cf2415bc50e62360917de6d629775d6f1cfa7047d6a5a4ba673206c16d57", "e3bb5f4784ee6d6fdc538fc39f09ef4f5a9e2c36705a3ae97b225735b76597e6"),
    (14, "B"): ("fddfe5c3cd2d37dbac1f47b65a96d7527bee14c88d40132108b381ab8f38d863", "fc2ccedd14c9284ccee18f7b7b8377ebe0757927d6fc1ddc2025c8c0f93d59e6"),
    (15, "A"): ("e8e264b19cad7cb0f0a6558f030aa9f722ea3d33eb106149532a3c9c66f26b1c", "9ad23a7012ad4d582673af6ea167862785201cbe1782540a4254907c71343b7f"),
    (15, "B"): ("55dfa0de09ef9255d1f2c7cc90562b36ddebeb0f1fcd67834c9d1cd57df3246c", "eb8b9faf6b38d5ab18994d5d04276912909f425791a37d1aaed9c79920debde6"),
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(value, reason):
    if not value:
        raise ValueError(reason)


def api_request(url, token):
    # Keep the token on api.github.com. The signed ZIP request below gets no
    # Authorization header, even if GitHub changes the artifact storage host.
    parsed = urllib.parse.urlparse(url)
    require(parsed.scheme == "https" and parsed.netloc == "api.github.com", "Unexpected API host")
    return urllib.request.Request(url, headers={"Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})


def fetch_zip(token):
    base = "https://api.github.com/repos/" + REPOSITORY
    opener = urllib.request.build_opener(NoRedirect())
    # An authenticated metadata redirect is unexpected and fails closed, too.
    with opener.open(api_request(base + "/actions/artifacts/" + str(ARTIFACT_ID), token), timeout=60) as response:
        metadata = json.load(response)
    require(metadata["id"] == ARTIFACT_ID and metadata["name"] == ARTIFACT_NAME, "Artifact identity mismatch")
    require(not metadata["expired"] and metadata["size_in_bytes"] < 8_000_000, "Artifact expired or unexpectedly large")
    require(metadata["digest"] == "sha256:" + ZIP_SHA256, "GitHub artifact digest mismatch")
    run = metadata["workflow_run"]
    require(run["id"] == RUN_ID and run["head_sha"] == CONTROLLER_SHA, "Original workflow provenance mismatch")
    try:
        response = opener.open(api_request(base + "/actions/artifacts/" + str(ARTIFACT_ID) + "/zip", token), timeout=60)
    except urllib.error.HTTPError as error:
        require(error.code in (301, 302, 303, 307, 308), "Artifact redirect unavailable")
        location = error.headers["Location"]
        parsed = urllib.parse.urlparse(location)
        require(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password,
                "Unsafe artifact redirect")
        # No GitHub token or other authentication is forwarded across origins.
        with urllib.request.urlopen(urllib.request.Request(location), timeout=60) as download:
            data = download.read(8_000_001)
    else:
        with response:
            data = response.read(8_000_001)
    require(len(data) <= 8_000_000 and digest(data) == ZIP_SHA256, "Downloaded ZIP digest mismatch")
    return data, metadata


def extract_safe(data, destination):
    require(not destination.exists(), "Preserving existing audit output; expected a fresh directory")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        require(len(members) <= 200 and sum(item.file_size for item in members) <= 100_000_000,
                "Artifact extraction budget exceeded")
        for item in members:
            path = pathlib.PurePosixPath(item.filename)
            require(not path.is_absolute() and ".." not in path.parts and "\\" not in item.filename,
                    "Unsafe archive path")
            require(not stat.S_ISLNK(item.external_attr >> 16), "Archive symlink rejected")
        destination.mkdir(parents=True)
        archive.extractall(destination)


def verify_payload(destination):
    matches = list(destination.glob("*/provenance.json"))
    require(len(matches) == 1, "Expected exactly one retained campaign")
    root = matches[0].parent
    provenance = json.loads(matches[0].read_text())
    require(str(provenance["githubRunId"]) == str(RUN_ID) and provenance["controllerSha"] == CONTROLLER_SHA,
            "Retained run/controller mismatch")
    require(provenance["executionOrder"] == "AB" and provenance["qualificationMode"] == "screen",
            "Retained order/population mismatch")
    for arm in ("A", "B"):
        require(provenance["harnesses"][arm]["checkoutSha"] == SOURCE_SHA, "Retained source SHA mismatch")
        config = json.loads((root / ("config-" + arm + ".json")).read_text())
        require(config["options"] == {"cacheProvider": None, "effort": 1, "retainBestPartialRouting": arm == "B"},
                "Retained constructor options mismatch")
    rows = [json.loads(line) for line in (root / "results.jsonl").read_text().splitlines() if line]
    require(len(rows) == 4, "Expected exactly four original matched records")
    seen = set()
    raw_hashes = []
    for row in rows:
        sample, arm = row["sampleNumber"], row["arm"]
        key = (sample, arm)
        require(key in EXPECTED_RAW and key not in seen, "Missing/duplicate/reindexed case")
        seen.add(key)
        require(row["dataset"] == "srj18" and row["sha"] == SOURCE_SHA and row["campaign"] == CAMPAIGN,
                "Record identity mismatch")
        require(row["executionOrder"] == "AB" and row["round"] == 1, "Record order mismatch")
        require(row["expectedInputHash"] == EXPECTED_INPUT[sample], "Original input hash mismatch")
        audit = row["official"]["routingMetrics"]["experimentAudit"]
        require((audit["rawOutputHash"], audit["rawNewTracesHash"]) == EXPECTED_RAW[key], "Record raw-output identity mismatch")
        raw = root / "round-1" / ("sample-%03d" % sample) / arm / "raw"
        for name, expected in (("original-input.json", EXPECTED_INPUT[sample]),
                               ("raw-solver-output.json", EXPECTED_RAW[key][0]),
                               ("raw-new-traces.json", EXPECTED_RAW[key][1])):
            require(digest((raw / name).read_bytes()) == expected, "Retained raw-content hash mismatch: " + name)
        raw_hashes.append({"sample": sample, "arm": arm, "inputSha256": EXPECTED_INPUT[sample],
                           "outputSha256": EXPECTED_RAW[key][0], "tracesSha256": EXPECTED_RAW[key][1]})
    require(seen == set(EXPECTED_RAW), "Incomplete matched records")
    return root, raw_hashes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    actual_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=args.source, text=True).strip()
    actual_tree = subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=args.source, text=True).strip()
    require((actual_sha, actual_tree) == (SOURCE_SHA, SOURCE_TREE), "Audit source checkout changed")
    data, metadata = fetch_zip(os.environ["GH_TOKEN"])
    extract_safe(data, args.output)
    root, raw_hashes = verify_payload(args.output)
    receipt = {"status": "PASS_EXISTING_ARTIFACT_IDENTITY_AND_RAW_HASHES", "repository": REPOSITORY,
        "originalRunId": RUN_ID, "artifactId": ARTIFACT_ID, "artifactDigestSha256": ZIP_SHA256,
        "originalControllerSha": CONTROLLER_SHA, "auditSourceSha": actual_sha, "auditSourceTree": actual_tree,
        "zipBytes": len(data), "campaignPath": str(root.resolve()), "rawHashes": raw_hashes,
        "scope": "Read-only checks on retained output; no routing, benchmark, timeout, validator or PCB fixture changes"}
    (args.output / "artifact-audit-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print("RETENTION_ARTIFACT_AUDIT_IDENTITY_JSON " + json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    main()
