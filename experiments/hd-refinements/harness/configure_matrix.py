#!/usr/bin/env python3
"""Bind source-only ablation templates to exact published/derived commits."""
import argparse
import json
from pathlib import Path

from arm_profiles import load_config


def configure(profile, head, derived, out, full=None):
    if profile == "legalization" and full is None:
        raise ValueError("Legalization requires the prespecified refined-full source commit")
    if profile == "portfolio" and full is not None:
        raise ValueError("Portfolio does not accept a full-legalization source commit")
    source = Path(__file__).resolve().parent / "configs" / f"{profile}.json.in"
    text = source.read_text().replace("REFINED_HEAD_SHA", head).replace("DERIVED_ABLATION_SHA", derived).replace("DERIVED_FULL_SHA", full or "UNBOUND_FULL_SHA")
    Path(out).write_text(text)
    config = load_config(out)
    Path(out).write_text(json.dumps(config, indent=2) + "\n")
    return config


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=["portfolio", "legalization"], required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--derived-sha", required=True)
    parser.add_argument("--full-sha")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    configure(args.profile, args.head_sha, args.derived_sha, args.out, args.full_sha)
