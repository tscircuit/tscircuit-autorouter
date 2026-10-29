#!/usr/bin/env python3
"""Seal only root-reviewed standalone diagnostic source; pending pins fail closed."""
import argparse
import copy
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("shadow_source_sealer",ROOT/"run-cache-shadow-diagnostic.py");runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
spec=importlib.util.spec_from_file_location("reviewed_source_sealer",ROOT/"seal-future-cache-manifest.py");sealer=importlib.util.module_from_spec(spec);spec.loader.exec_module(sealer)
def main():
    p=argparse.ArgumentParser();p.add_argument("--sources",type=Path);args=p.parse_args();m=json.loads(runner.MANIFEST.read_text())
    if args.sources:
        receipt=json.loads(args.sources.read_text());item=copy.deepcopy(m["candidate"]);paths=item["evidencePaths"];item["evidencePaths"]=[item["coverageContract"]["statsPath"]]
        sealer.apply_sources({"requestedExperiments":[item["id"]],"experiments":[item]},receipt,runner.common)
        item["evidencePaths"]=paths;item["sourceBranch"]=receipt[item["id"]]["sourceBranch"];m["candidate"]=item
    m["authoritySha256"]=runner.sha(runner.AUTHORITY);m["workflowSha256"]=runner.sha(runner.WORKFLOW)
    m["runtimeSourceHashes"]={n:runner.sha(ROOT/n) for n in sorted(runner.assets())}
    m["runSampleSourceSha256"]=hashlib.sha256(inspect.getsource(runner.common.pinned.run_sample).encode()).hexdigest()
    runner.MANIFEST.write_text(json.dumps(m,indent=2)+"\n")
    if args.sources:runner.validate()
    print(json.dumps({"status":"SEALED_DIAGNOSTIC_SOURCE" if args.sources else "PENDING_SOURCE_PUBLICATION_FAIL_CLOSED","manifestSha256":runner.sha(runner.MANIFEST)}))
if __name__=="__main__":main()
