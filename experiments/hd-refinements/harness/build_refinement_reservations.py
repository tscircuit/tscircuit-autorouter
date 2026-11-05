#!/usr/bin/env python3
"""Freeze board admission estimates from a previous table and archived CI records.

Only this offline generator reads archives. The routing driver consumes the
resulting static JSON and never needs an archive path or historical checkout.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

GIB = 1024 ** 3
QUARTER_GIB = GIB // 4
EXCLUSIVE = {("srj24", 1), ("srj24", 4), ("srj24", 24)}
CAPPED = {("srj24", 3), ("srj24", 11), ("srj24", 18)}
EXPECTED_BOARDS = {(dataset, sample) for dataset, count in [("srj18", 16), ("srj24", 26)] for sample in range(1, count + 1)}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def estimate_bytes(observed, board):
    # Integer arithmetic makes the 1.5x + 0.5GiB rule and quarter-GiB
    # ceiling reproducible without floating-point rounding at a boundary.
    estimate = max(5 * GIB // 4, (3 * observed + 1) // 2 + GIB // 2)
    if board in CAPPED:
        estimate = max(estimate, 8 * GIB)
    return ((estimate + QUARTER_GIB - 1) // QUARTER_GIB) * QUARTER_GIB


def build(previous_policy, archives, budget_gib=13, expected_cohorts=9):
    if not isinstance(budget_gib, (int, float)) or not math.isfinite(budget_gib) or budget_gib < 1:
        raise ValueError("Budget must be finite and at least1GiB")
    previous_policy = Path(previous_policy)
    archives = Path(archives)
    old_bytes = previous_policy.read_bytes()
    old = json.loads(old_bytes)
    if old.get("schemaVersion") != 1:
        raise ValueError("Previous reservation policy must use schemaVersion1")
    expected_keys = {f"{dataset}:{sample}" for dataset, sample in EXPECTED_BOARDS}
    if set(old.get("samples", {})) != expected_keys:
        raise ValueError("Previous reservation policy must contain exactly all42 boards")
    observations = {board: [] for board in EXPECTED_BOARDS}

    def add(board, value, source, sha256, **metadata):
        if board not in EXPECTED_BOARDS:
            raise ValueError(f"Unexpected board {board} in {source}")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"Invalid observed RSS {value!r} in {source}")
        observations[board].append({"peakRssBytes": int(value), "source": source, "sha256": sha256, **metadata})

    previous_sha = digest(old_bytes)
    for board in sorted(EXPECTED_BOARDS):
        key = f"{board[0]}:{board[1]}"
        add(board, old["samples"][key]["observedPeakRssBytes"], "previous-policy/memory-reservations.json", previous_sha,
            kind="previous-policy-maximum")
    sources = [{"kind": "previous-policy", "path": "previous-policy/memory-reservations.json", "sha256": previous_sha,
        "boardCount": 42, "inheritedSources": old.get("sources", [])}]
    cohort_roots = sorted(path for path in archives.glob("*/artifact/full") if path.is_dir())
    if len(cohort_roots) != expected_cohorts:
        raise ValueError(f"Expected {expected_cohorts} complete CI cohorts, found {len(cohort_roots)}")
    remote_record_count = 0
    for full in cohort_roots:
        cohort = full.parent.parent.name
        records = []
        observed_keys = set()
        arms = {}
        for path in sorted(full.glob("*/*.json")):
            if path.name.endswith((".task.json", ".output.json")):
                continue
            data = path.read_bytes()
            report = json.loads(data)
            if "result" not in report:
                raise ValueError(f"Archive report has no result: {path}")
            variant = report["variant"]
            board = report["dataset"], report["sampleNumber"]
            key = variant, *board
            if key in observed_keys:
                raise ValueError(f"Duplicate board record in {cohort}: {key}")
            observed_keys.add(key)
            commit = report["commit"]
            if variant in arms and arms[variant] != commit:
                raise ValueError(f"Arm commit changes within cohort {cohort}: {variant}")
            arms[variant] = commit
            source = f"remote-paired/{cohort}/artifact/full/{path.parent.name}/{path.name}"
            file_sha = digest(data)
            add(board, report["result"].get("peakRssBytes"), source, file_sha,
                kind="archived-ci-report", cohort=cohort, variant=variant, commit=commit)
            records.append((source, file_sha))
        if len(arms) != 2:
            raise ValueError(f"Expected two arms in paired cohort {cohort}, found {sorted(arms)}")
        expected = {(variant, *board) for variant in arms for board in EXPECTED_BOARDS}
        if observed_keys != expected:
            raise ValueError(f"Cohort {cohort} must contain84 unique records; missing={sorted(expected - observed_keys)} unexpected={sorted(observed_keys - expected)}")
        # The table retains the individual file hashes in its observations;
        # this manifest hash also authenticates each complete cohort index.
        manifest = "".join(f"{source}\t{file_sha}\n" for source, file_sha in records).encode()
        sources.append({"kind": "archived-paired-ci", "cohort": cohort, "recordCount": len(records),
            "arms": arms, "recordManifestSha256": digest(manifest)})
        remote_record_count += len(records)
    budget = int(budget_gib * GIB)
    samples = {}
    for board in sorted(EXPECTED_BOARDS):
        records = observations[board]
        observed = max(record["peakRssBytes"] for record in records)
        estimate = estimate_bytes(observed, board)
        exclusive = board in EXCLUSIVE or estimate > budget
        samples[f"{board[0]}:{board[1]}"] = {
            "observedPeakRssBytes": observed,
            "estimatedPeakWithMarginBytes": estimate,
            "reservationBytes": budget if exclusive else estimate,
            "exclusive": exclusive,
            "observationCount": len(records),
            "observations": sorted(records, key=lambda record: (-record["peakRssBytes"], record["source"])),
        }
    return {
        "schemaVersion": 1,
        "budgetBytes": budget,
        "method": "Each board uses one arm-independent maximum observed full-process RSS across the previous static policy and all9 archived paired CI cohorts, including controls and experiments. Estimate=max(1.25GiB,1.5*observed+0.5GiB), rounded up to0.25GiB; capped srj24#3/#11/#18 retain at least8GiB. Default13GiB profile keeps srj24#1/#4/#24 exclusive and makes any estimate above its budget exclusive. With explicit heavy-overlap, the same scheduler uses the unclamped estimate; only estimates exceeding the selected runtime admission budget (48 or64GiB) are exclusive. These are admission estimates, not solver memory caps or proven upper bounds. This static table has no runtime dependency on archive files.",
        "provenance": {"previousPolicyBoardCount": 42, "archivedCohortCount": len(cohort_roots),
            "archivedRecordCount": remote_record_count, "sourceFileCount": remote_record_count + 1,
            "observationCount": sum(len(records) for records in observations.values()),
            "generator": "build_refinement_reservations.py"},
        "sources": sources,
        "samples": samples,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous-policy", type=Path, required=True)
    parser.add_argument("--archives", type=Path, required=True)
    parser.add_argument("--budget-gib", type=float, default=13)
    parser.add_argument("--expected-cohorts", type=int, default=9)
    parser.add_argument("--out", type=Path, default=Path(__file__).with_name("memory-reservations.json"))
    args = parser.parse_args()
    policy = build(args.previous_policy, args.archives, args.budget_gib, args.expected_cohorts)
    args.out.write_text(json.dumps(policy, indent=2) + "\n")
    print(json.dumps({"out": str(args.out), "sha256": digest(args.out.read_bytes()), "provenance": policy["provenance"]}, indent=2))
    for key, row in policy["samples"].items():
        print(f"{key:9s} observed={row['observedPeakRssBytes']/GIB:5.2f}GiB estimate={row['estimatedPeakWithMarginBytes']/GIB:5.2f}GiB defaultExclusive={row['exclusive']}")
