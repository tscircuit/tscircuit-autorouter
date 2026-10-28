#!/usr/bin/env python3
"""Build a checked-in admission policy from historical and fresh measured RSS."""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path

GIB = 1024**3
EXCLUSIVE = {("srj24", 1), ("srj24", 4), ("srj24", 24)}
CAPPED = {("srj24", 3), ("srj24", 11), ("srj24", 18)}


def build(args):
    observations = {}
    sources = []

    def add(dataset, sample, rss, source):
        if not isinstance(rss, (int, float)) or not math.isfinite(rss) or rss <= 0:
            return
        key = (dataset, sample)
        observations.setdefault(key, []).append({"peakRssBytes": int(rss), "source": source})

    for dataset, path in [("srj18", args.dataset18_profile), ("srj24", args.dataset24_profile)]:
        data = path.read_bytes()
        sources.append({"path": str(path.resolve()), "sha256": hashlib.sha256(data).hexdigest()})
        profile = json.loads(data)
        for record in profile["tests"]:
            add(dataset, record["sampleNumber"], record.get("peakRssBytes"), str(path.resolve()))
    for root in args.results:
        for path in (root / "full").glob("*/*.json"):
            if path.name.endswith((".task.json", ".output.json")):
                continue
            try:
                report = json.loads(path.read_text())
            except (ValueError, OSError):
                # A live invocation can be atomically between worker and
                # parent writes. Its other complete records are still useful.
                continue
            if "result" in report:
                add(report["dataset"], report["sampleNumber"],
                    report["result"].get("peakRssBytes"), str(path.resolve()))
    samples = {}
    for dataset, size in [("srj18", 16), ("srj24", 26)]:
        for sample in range(1, size + 1):
            records = observations.get((dataset, sample))
            if not records:
                raise ValueError(f"No measured RSS for {dataset} sample {sample}")
            observed = max(record["peakRssBytes"] for record in records)
            estimate = max(1.25 * GIB, observed * 1.5 + 0.5 * GIB)
            if (dataset, sample) in CAPPED:
                estimate = max(estimate, 8 * GIB)
            rounded = math.ceil(estimate / (GIB / 4)) * (GIB // 4)
            exclusive = (dataset, sample) in EXCLUSIVE or rounded > args.budget_gib * GIB
            reservation = int(args.budget_gib * GIB) if exclusive else rounded
            samples[f"{dataset}:{sample}"] = {
                "observedPeakRssBytes": observed,
                "estimatedPeakWithMarginBytes": rounded,
                "reservationBytes": reservation,
                "exclusive": exclusive,
                "observations": sorted(records, key=lambda r: r["peakRssBytes"], reverse=True),
            }
    return {
        "schemaVersion": 1,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "budgetBytes": int(args.budget_gib * GIB),
        "method": "Per-sample maximum observed full-process RSS across historical profile and completed fresh matrix records. Reservation=max(1.25GiB, 1.5*observed+0.5GiB), rounded up to0.25GiB. Capped srj24#3/#11/#18 reserve at least8GiB. srj24#1/#4/#24 reserve the entire13GiB admission budget and are exclusive. Estimates exceeding the admission budget also run exclusively. This is an admission estimate, not a bound or process memory cap.",
        "sources": sources,
        "samples": samples,
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dataset18-profile", type=Path, required=True)
    p.add_argument("--dataset24-profile", type=Path, required=True)
    p.add_argument("--results", type=Path, action="append", default=[])
    p.add_argument("--budget-gib", type=float, default=13)
    p.add_argument("--out", type=Path, default=Path(__file__).with_name("memory-reservations.json"))
    args = p.parse_args()
    policy = build(args)
    args.out.write_text(json.dumps(policy, indent=2) + "\n")
    for key, value in policy["samples"].items():
        print(f"{key:9s} observed={value['observedPeakRssBytes']/GIB:5.2f}GiB reserve={value['reservationBytes']/GIB:5.2f}GiB exclusive={value['exclusive']}")
