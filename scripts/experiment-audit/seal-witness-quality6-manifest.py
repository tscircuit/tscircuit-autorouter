#!/usr/bin/env python3
"""Bind additive quality-study controller bytes to the independently qualified standalone witness source."""
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('witness_quality6_sealer',ROOT/'run-witness-quality6.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
def main():
    m=json.loads(r.MANIFEST.read_text());m['authoritySha256']=r.sha(r.AUTHORITY);m['workflowSha256']=r.sha(r.WORKFLOW);m['runtimeSourceHashes']={n:r.sha(ROOT/n) for n in sorted(r.assets())};m['runSampleSourceSha256']=hashlib.sha256(inspect.getsource(r.common.pinned.run_sample).encode()).hexdigest();r.MANIFEST.write_text(json.dumps(m,indent=2)+'\n');r.validate();print(json.dumps({'status':'SEALED_WITNESS_QUALITY6','manifestSha256':r.sha(r.MANIFEST)}))
if __name__=='__main__':main()
