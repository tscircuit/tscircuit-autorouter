#!/usr/bin/env python3
"""Compare saved physical output; never import or rerun a router."""

import argparse
from collections import Counter
import gzip
import json
from pathlib import Path
import re


COPPER = {"pcb_trace", "pcb_via", "pcb_copper_pour"}
SHARED = {
    "overlap", "padTrace", "viaTrace", "viaPad", "viaSpacing", "contiguous",
    "viaInPad", "holeTrace", "trace_overlap", "pad_trace", "via_trace",
    "via_pad", "via_spacing", "via_in_pad", "hole_trace", "width",
}
NONPHYSICAL = {"routing", "missing_traces", "disconnected_ports"}
WIDTH_WARNING_FIELDS = {"type", "pcb_trace_warning_id", "warning_type", "message", "center",
                        "source_trace_id", "pcb_trace_id", "pcb_component_ids", "pcb_port_ids"}
REFERENCE_FIELDS = {"pcb_trace_id", "pcb_via_id", "pcb_via_ids", "pcb_pad_ids"}
EMBEDDED_IDS = {
    ("pcb_trace_error", "pcb_trace_error_id"): "overlap_",
    ("pcb_via_trace_clearance_error", "pcb_via_trace_clearance_error_id"): "via_trace_clearance_",
    ("pcb_pad_pad_clearance_error", "pcb_pad_pad_clearance_error_id"): "via_pad_clearance_",
    ("pcb_via_clearance_error", "pcb_error_id"): "different_net_vias_close_",
}


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def indexed_rows(circuit: list, kind: str) -> dict:
    selected = [row for row in circuit if row["type"] == kind]
    key = f"{kind}_id"
    require(all(isinstance(row.get(key), str) for row in selected), f"Missing {key}")
    result = {row[key]: row for row in selected}
    require(len(result) == len(selected), f"Duplicate {key}")
    return result


def match_rows(before: dict, after: dict, own_id: str, owner_map: dict | None = None) -> tuple:
    """All fields except the generated ID must identify exactly one row."""
    fingerprints = {}
    for identifier, row in before.items():
        fingerprint = canonical({key: value for key, value in row.items() if key != own_id})
        require(fingerprint not in fingerprints, f"Ambiguous baseline {own_id} fingerprint")
        fingerprints[fingerprint] = identifier
    mapping, added, seen = {}, [], set()
    for identifier, row in after.items():
        value = {key: item for key, item in row.items() if key != own_id}
        if owner_map is not None:
            owner = value["pcb_trace_id"]
            # An added trace cannot be mistaken for a preserved owner with the same ID.
            if owner not in owner_map:
                added.append(identifier)
                continue
            value["pcb_trace_id"] = owner_map[owner]
        fingerprint = canonical(value)
        require(fingerprint not in seen, f"Ambiguous candidate {own_id} fingerprint")
        seen.add(fingerprint)
        if fingerprint not in fingerprints:
            added.append(identifier)
            continue
        mapping[identifier] = fingerprints[fingerprint]
    require(set(mapping.values()) == set(before), f"Missing or changed {own_id} geometry/ownership")
    return mapping, added


def remap_row(row: dict, mapping: dict, pattern: re.Pattern | None) -> dict:
    """Only typed references and four observed finding-ID formats may change."""
    result = {}
    for key, value in row.items():
        if key in REFERENCE_FIELDS:
            if isinstance(value, list):
                result[key] = [mapping.get(item, item) for item in value]
            else:
                result[key] = mapping.get(value, value)
            continue
        prefix = EMBEDDED_IDS.get((row["type"], key))
        if prefix and isinstance(value, str) and value.startswith(prefix):
            # Decode exactly two complete IDs. Substring replacement could confuse
            # pcb_via_1 with pcb_via_10 or silently change another object identifier.
            suffix = value[len(prefix):]
            pairs = [(left, suffix[len(left) + 1:]) for left in mapping
                     if suffix.startswith(left + "_")]
            pairs = [(left, right) for left, right in pairs if right in mapping or right.startswith("pcb_smtpad_")]
            require(len(pairs) == 1, f"HOLD: ambiguous finding identifier {value}")
            left, right = pairs[0]
            result[key] = prefix + mapping[left] + "_" + mapping.get(right, right)
            continue
        require(not pattern or not pattern.search(canonical(value)),
                f"HOLD: unreviewed generated-ID reference in {row['type']}.{key}")
        result[key] = value
    return result


def compare_physical(baseline_run: dict, candidate_run: dict, accepted_gain: bool = False) -> dict:
    case = (baseline_run["result"]["id"], baseline_run["result"]["cohort"])
    require(case == (candidate_run["result"]["id"], candidate_run["result"]["cohort"]), "Different board/cohort")
    require(not accepted_gain or case == ("butterstick", "spaced"),
            "Accepted additions are restricted to the independently qualified ButterStick case")
    before, after = baseline_run["circuit"], candidate_run["circuit"]
    before_traces, after_traces = indexed_rows(before, "pcb_trace"), indexed_rows(after, "pcb_trace")
    before_vias, after_vias = indexed_rows(before, "pcb_via"), indexed_rows(after, "pcb_via")
    for traces, vias in ((before_traces, before_vias), (after_traces, after_vias)):
        require(all(via.get("pcb_trace_id") in traces for via in vias.values()), "Orphan via trace owner")
        for trace in traces.values():
            require(all(point.get("route_type") in {"wire", "via", "through_pad"} for point in trace["route"]),
                    "HOLD: unreviewed route primitive")
    trace_map, added_traces = match_rows(before_traces, after_traces, "pcb_trace_id")
    via_map, added_vias = match_rows(before_vias, after_vias, "pcb_via_id", trace_map)
    require(accepted_gain or not (added_traces or added_vias), "Unexpected added/changed copper")
    require(not (set(trace_map) & set(via_map)), "Trace/via identifier collision")
    mapping = trace_map | via_map
    changed = {key for key, value in mapping.items() if key != value}
    pattern = re.compile("|".join(re.escape(key) for key in sorted(changed, key=len, reverse=True))) if changed else None
    # Keep unmatched candidate IDs distinct even if they reuse a former baseline ID.
    require(not any(identifier in mapping.values() for identifier in added_traces + added_vias),
            "HOLD: added copper reuses a baseline ID")
    pours_before, pours_after = indexed_rows(before, "pcb_copper_pour"), indexed_rows(after, "pcb_copper_pour")
    require(Counter(canonical(row) for row in pours_before.values()) ==
            Counter(canonical(row) for row in pours_after.values()), "Copper pour geometry/ownership changed")

    def fixed_rows(circuit: list, remap: bool) -> Counter:
        selected = []
        for row in circuit:
            if row["type"] in COPPER or row["type"] == "pcb_debug_object":
                continue
            if accepted_gain and row["type"] == "pcb_port_not_connected_error":
                continue
            selected.append(canonical(remap_row(row, mapping, pattern) if remap else row))
        return Counter(selected)

    require(fixed_rows(before, False) == fixed_rows(after, True),
            "Source, fixed physical geometry or saved diagnostic rows changed")
    if accepted_gain:
        disconnected = lambda circuit: Counter(canonical({key: value for key, value in row.items()
                                                         if key != "pcb_port_not_connected_error_id"})
                                               for row in circuit if row["type"] == "pcb_port_not_connected_error")
        require(not (disconnected(after) - disconnected(before)), "New saved disconnected-port diagnostic")

    baseline_findings, candidate_findings = baseline_run["findings"], candidate_run["findings"]
    require(baseline_findings.keys() == candidate_findings.keys(), "Physical finding groups changed")
    require(set(baseline_findings) <= SHARED | NONPHYSICAL, "HOLD: unreviewed finding group")
    finding_counts, added_width_warnings = {}, []
    for group, values in baseline_findings.items():
        baseline_rows = Counter(canonical(row) for row in values)
        candidate_rows = Counter(canonical(remap_row(row, mapping, pattern)) for row in candidate_findings[group])
        if accepted_gain and group == "width":
            require(not (baseline_rows - candidate_rows), "Existing width findings changed")
            source_traces = {row["source_trace_id"]: row for row in after if row["type"] == "source_trace"}
            for encoded, count in (candidate_rows - baseline_rows).items():
                warning = json.loads(encoded)
                require(set(warning) == WIDTH_WARNING_FIELDS and warning["type"] == "pcb_trace_warning"
                        and warning["warning_type"] == "pcb_trace_warning",
                        "New width error or unreviewed width-warning schema")
                trace_id = warning["pcb_trace_id"]
                require(trace_id in added_traces, "New width warning on preserved copper")
                owner = after_traces[trace_id]["source_trace_id"]
                owners = {owner}
                if owner in source_traces:
                    owners.update(source_traces[owner]["connected_source_net_ids"])
                require(warning["source_trace_id"] in owners, "Width warning has a different source owner")
                added_width_warnings.extend([warning] * count)
        elif group in SHARED or accepted_gain and group in {"missing_traces", "disconnected_ports"}:
            require(not (candidate_rows - baseline_rows), f"New physical/conflict finding: {group}")
        else:
            require(candidate_rows == baseline_rows, f"Finding instances changed: {group}")
        for run in (baseline_run, candidate_run):
            count = sum(row["type"].endswith("_error") for row in run["findings"][group])
            require(run["assessment"]["findings"][group] == count, f"Assessment finding count differs: {group}")
        finding_counts[group] = {"before": sum(baseline_rows.values()), "after": sum(candidate_rows.values())}
    return {
        "passed": True, "acceptedGainRequiresIndependentMaterializationProof": accepted_gain,
        "traceIdMap": {old: new for new, old in trace_map.items()},
        "viaIdMap": {old: new for new, old in via_map.items()},
        "addedTraceIds": added_traces, "addedViaIds": added_vias,
        "preservedTraces": len(trace_map), "preservedVias": len(via_map),
        "preservedPours": len(pours_before), "findingInstances": finding_counts,
        "newWidthWarnings": added_width_warnings,
        "ignoredDebugRows": {"before": sum(row["type"] == "pcb_debug_object" for row in before),
                             "after": sum(row["type"] == "pcb_debug_object" for row in after)},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--accepted-gain", action="store_true")
    args = parser.parse_args()
    runs = []
    for folder in (args.baseline, args.candidate):
        run = {}
        for name, filename in (("circuit", "circuit.json.gz"), ("findings", "findings.json.gz"),
                               ("assessment", "assessment.json"), ("result", "result.json")):
            raw = (folder / filename).read_bytes()
            run[name] = json.loads(gzip.decompress(raw) if filename.endswith(".gz") else raw)
        runs.append(run)
    print(json.dumps(compare_physical(*runs, accepted_gain=args.accepted_gain), indent=2))


if __name__ == "__main__":
    main()
