"""Seal only fresh additive transport correction; retain reviewed source/input."""
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('main_mst_trial_transport_hotfix',ROOT/'run-witness-relative-v2-srj18-trial-hotfix.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)


def main():
    original=json.loads((ROOT/'witness-relative-v2-srj18-trial-20261030.json').read_bytes());value=json.loads(runner.MANIFEST.read_bytes())
    changed={'campaign','assetHashes','workflowSha256','inputSourceRun','hotfixInheritedLocal','hotfixInheritedTree','hotfixExpectedRemoteParent','supersedesNonqualifyingRun','transportCorrection'}
    runner.require({k:v for k,v in value.items()if k not in changed}=={k:v for k,v in original.items()if k not in changed},'Transport hotfix changed reviewed source/input/stage/acceptance pins')
    runner.require(value['sealState']=='SEALED'and value['assetHashes']=={}and value['workflowSha256']=='UNSEALED','Only fresh transport controller may be sealed')
    value['assetHashes']={name:runner.sha((ROOT/name).read_bytes())for name in runner.ASSETS};value['workflowSha256']=runner.sha(runner.WORKFLOW.read_bytes())
    runner.MANIFEST.write_text(json.dumps(value,indent=2)+'\n');runner.validate()
    print(json.dumps({'status':'SEALED_ADDITIVE_EXACT_MAIN_MST_INPUT_TRANSPORT_CORRECTION','manifestSha256':runner.sha(runner.MANIFEST.read_bytes()),'sourceAndExactInputUnchanged':True,'actualStageOrCheckerExecutions':0,'accepted':False}))


if __name__=='__main__':main()
