#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('local_component_seal',ROOT/'run-witness-local-repair-diagnostic.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
m=json.loads(runner.MANIFEST.read_text());m['assetHashes']={name:runner.sha((ROOT/name).read_bytes()) for name in runner.ASSETS};m['workflowSha256']=runner.sha(runner.WORKFLOW.read_bytes());runner.MANIFEST.write_text(json.dumps(m,indent=2)+'\n');runner.validate();print(json.dumps({'status':'SEALED_COMPONENT_DIAGNOSTIC_ONLY','manifestSha256':runner.sha(runner.MANIFEST.read_bytes())}))
