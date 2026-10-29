#!/usr/bin/env python3
"""Bind additive timing-study controller bytes to already qualified scratch/native sources."""
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('scratch_repeat_sealer',ROOT/'run-scratch-repeat.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
def main():
    m=json.loads(r.MANIFEST.read_text());m['authoritySha256']=r.sha(r.AUTHORITY);m['workflowSha256']=r.sha(r.WORKFLOW);m['runtimeSourceHashes']={n:r.sha(ROOT/n) for n in sorted(r.assets())};m['runSampleSourceSha256']=hashlib.sha256(inspect.getsource(r.common.pinned.run_sample).encode()).hexdigest();r.MANIFEST.write_text(json.dumps(m,indent=2)+'\n');r.validate();print(json.dumps({'status':'SEALED_REPEAT16','manifestSha256':r.sha(r.MANIFEST)}))
if __name__=='__main__':main()
