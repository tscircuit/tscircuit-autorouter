#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('contact_diagnostic_sealer',ROOT/'run-witness-contact-diagnostic.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
m=json.loads(r.MANIFEST.read_text());m['assetHashes']={name:r.sha((ROOT/name).read_bytes()) for name in r.ASSETS};m['workflowSha256']=r.sha(r.WORKFLOW.read_bytes());r.MANIFEST.write_text(json.dumps(m,indent=2)+'\n');r.validate();print(json.dumps({'status':'SEALED_CONTACT_DIAGNOSTIC_ONLY','manifestSha256':r.sha(r.MANIFEST.read_bytes())}))
