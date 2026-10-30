"""Blacksmith-only data replay of actual production output, never a proposal or route."""
import argparse,hashlib,importlib.util,json,os
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('immutable_actual_stage_relative_proof',ROOT/'replay-witness-relative-v2-srj18-proof.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior)
def replay(original,raw,output,canonical,trial):return prior.replay(original,raw,output,canonical,trial)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();prior.require(os.environ.get('GITHUB_ACTIONS')=='true','Actual retained V4 proof replay is Blacksmith-only');root=args.output;read=lambda name:json.loads((root/name).read_bytes());value=replay(read('original-input.json'),read('raw-new-traces.json'),read('production-stage-output-traces.json'),read('canonical-circuit-json.json'),read('production-stage-trial.json'));target=root/'independent-relative-proof-replay.json';prior.require(not target.exists(),'Fresh actual-stage replay required');target.write_text(json.dumps(value,indent=2)+'\n');print(json.dumps({'status':value['status'],'receiptSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'productionStageSolveCalls':1,'accepted':False}))
if __name__=='__main__':main()
