#!/usr/bin/env python3
"""Keep the unchanged original strict parser and bind refined source authority."""
import argparse
import json
import pathlib
import re


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("log", type=pathlib.Path)
    parser.add_argument("--runtime-file", type=pathlib.Path, required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--experiment", choices=["delta-drc", "joint-layers"], required=True)
    parser.add_argument("--dataset", choices=["srj18", "srj24"], required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--controller-sha", required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    import importlib.util
    spec = importlib.util.spec_from_file_location("refinement_parser_runtime", args.runtime_file)
    followup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(followup)
    r = followup.r
    r.require(r.digest(args.controller_sha) and all(re.fullmatch(r"[1-9][0-9]*", value)
              for value in [args.run_id, args.job_id]), "Exact run/job/controller identities required")
    spec_manifest, manifest = followup.validate_manifest(args.manifest)
    original = followup.load_module("original_strict_parser", followup.ROOT / "parse-new-experiments-log.py")
    result = original.parse_log(args.log.read_text(), r, manifest, r.select(manifest, args.experiment),
                                args.dataset, "BA", args.run_id, args.controller_sha)
    result.update(jobId=args.job_id, rawLogSha256=r.sha(args.log),
                  manifestSha256=r.sha(args.manifest), runtimeSha256=r.sha(args.runtime_file),
                  refinementController=manifest["refinementController"],
                  originalAB=spec_manifest["originalAB"],
                  strictTimeoutPolicy=spec_manifest["strictTimeoutPolicy"],
                  timingsPooledAcrossCampaigns=False)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: result[key] for key in ["experiment", "dataset", "observedRecordCount",
                     "expectedRecordCount", "populationComplete", "strictlyQualified", "integrityIssues"]}))
    if not result["strictlyQualified"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
