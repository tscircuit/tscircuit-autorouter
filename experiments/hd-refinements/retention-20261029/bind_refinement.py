#!/usr/bin/env python3
"""Bind the prespecified three-source legalization comparison to an exact candidate."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re

TEMPLATE_SHA256 = {"full": "8d30c215e3725d3b7ef51b7dd554bd01c36e2fa73d4e04495560a5146a13a8dd"}
SHA = re.compile(r"^[0-9a-f]{40}$")


def bind(template, harness, head, out, profile):
    raw = template.read_bytes()
    if hashlib.sha256(raw).hexdigest() != TEMPLATE_SHA256[profile]:
        raise ValueError("Retention confirmation template bytes differ from the prespecified template")
    if not SHA.fullmatch(head):
        raise ValueError("Retention candidate source ref must be an exact forty-character commit SHA")
    config = json.loads(raw.decode().replace("REFINED_LEGALIZATION_HEAD_SHA", head))
    if len({arm['commit'] for arm in config['arms']}) != len(config['arms']):
        raise ValueError("Retention confirmation requires three distinct exact source commits")
    spec = importlib.util.spec_from_file_location("legal_confirmation_arm_profiles", harness / "arm_profiles.py")
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
    parser.add_argument("--template", type=Path, default=None)
    parser.add_argument("--profile", choices=["full"], required=True)
    parser.add_argument("--harness", type=Path, required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    template = args.template or Path(__file__).with_name(args.profile + ".json.in")
    bind(template, args.harness, args.head_sha, args.out, args.profile)
