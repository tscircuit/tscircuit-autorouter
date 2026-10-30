"""Seal only a fresh diagnostic manifest; source/input pins stay immutable."""
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('main18_component_seal',ROOT/'run-relative-v2-main18-component-diagnostic.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)


def main():
    value=json.loads(runner.MANIFEST.read_bytes())
    runner.require(value['assetHashes']=={}and value['workflowSha256']=='UNSEALED','Only fresh diagnostic manifests may be sealed')
    value['assetHashes']={name:runner.sha((ROOT/name).read_bytes())for name in runner.ASSETS};value['workflowSha256']=runner.sha(runner.WORKFLOW.read_bytes())
    runner.MANIFEST.write_text(json.dumps(value,indent=2)+'\n');runner.validate()
    print(json.dumps({'status':'SEALED_RETAINED_COMPONENT_DIAGNOSTIC_ONLY','manifestSha256':runner.sha(runner.MANIFEST.read_bytes()),'sourceSha':value['sourceSha'],'stageSolveCalls':0,'accepted':False}))


if __name__=='__main__':main()
