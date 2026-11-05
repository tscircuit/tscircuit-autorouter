#!/usr/bin/env python3
"""Bind the prespecified confirmation to exact independent source commits."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re

TEMPLATE_SHA256 = "611973ae75130fb4dded3a17e8ef3d744270e0a344e9cbad65ca993fe2bf9c95"
SHA = re.compile(r"^[0-9a-f]{40}$")


def bind(template, harness, head, portfolio, out):
    raw = template.read_bytes()
    if hashlib.sha256(raw).hexdigest() != TEMPLATE_SHA256:
        raise ValueError("Confirmation template bytes differ from the prespecified template")
    if not SHA.fullmatch(head) or not SHA.fullmatch(portfolio):
        raise ValueError("Both source refs must be exact forty-character commit SHAs")
    source = raw.decode().replace("LEGALIZATION_HEAD_SHA", head).replace("PORTFOLIO_SOURCE_SHA", portfolio)
    config = json.loads(source)
    if len({arm['commit'] for arm in config['arms']}) != len(config['arms']):
        raise ValueError("Confirmation requires four distinct exact source commits")
    spec = importlib.util.spec_from_file_location("confirmation_arm_profiles", harness / "arm_profiles.py")
    profiles = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(profiles)
    if out.exists():
        raise ValueError("Refusing to overwrite a prior independently approved configuration")
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        out.write_text(json.dumps(config, indent=2) + "\n")
        config = profiles.load_config(out)
        out.write_text(json.dumps(config, indent=2) + "\n")
    except BaseException:
        if out.exists():
            out.unlink()
        raise
    return config


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, default=Path(__file__).with_name("combined-confirmation.json.in"))
    parser.add_argument("--harness", type=Path, required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--portfolio-sha", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    bind(args.template, args.harness, args.head_sha, args.portfolio_sha, args.out)
