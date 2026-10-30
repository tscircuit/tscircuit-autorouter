#!/usr/bin/env python3
"""Prepare an explicitly unsealed draft, or bind reviewed published new source."""
import argparse
import importlib.util
import json
import re
from pathlib import Path

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('retained_stage_trial_seal',ROOT/'run-witness-relative-v2-srj18-trial.py');runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source-pins',type=Path);args=parser.parse_args();m=json.loads(runner.MANIFEST.read_bytes())
    if args.source_pins:
        pins=json.loads(args.source_pins.read_bytes())
        runner.require(m['sealState']=='UNSEALED','Already sealed source must not be silently resealed')
        runner.require(set(pins)=={'sourceSha','sourceTree','sourceBaseSha','sourceFileHashes','sourceReceiptPins','sourceDefaultOffReviewed'},'Unexpected source pin handoff fields')
        runner.require(pins['sourceBaseSha']==m['sourceBaseSha'],'Reviewed new source has wrong reviewed C9 parent/base')
        runner.require(all(isinstance(pins[k],str)and re.fullmatch('[0-9a-f]{40}',pins[k])for k in ['sourceSha','sourceTree'])and pins['sourceSha']!=m['sourceBaseSha']and pins['sourceTree']!=m['sourceBaseTree'],'Complete new production source SHA/tree required')
        runner.require(set(pins['sourceFileHashes'])==set(runner.SOURCE_ASSETS)and set(pins['sourceReceiptPins'])=={'authorQaSha256','independentReviewSha256','publicationReceiptSha256'},'Production source hash/receipt fields differ')
        runner.require(all(isinstance(v,str)and re.fullmatch('[0-9a-f]{64}',v)for v in [*pins['sourceFileHashes'].values(),*pins['sourceReceiptPins'].values()])and pins['sourceDefaultOffReviewed']is True,'Source QA/review/publication/default-off review must precede sealing')
        for key in ['sourceSha','sourceTree','sourceFileHashes','sourceReceiptPins','sourceDefaultOffReviewed']:m[key]=pins[key]
        m['sealState']='SEALED'
        text=runner.WORKFLOW.read_text();runner.require(text.count('UNSEALED_SOURCE_SHA_DO_NOT_RUN')==1,'Fresh workflow source placeholder required')
        runner.WORKFLOW.write_text(text.replace('UNSEALED_SOURCE_SHA_DO_NOT_RUN',m['sourceSha']))
    else:runner.require(m['sealState']=='UNSEALED','Draft sealing cannot rewrite an existing source seal')
    m['assetHashes']={name:runner.sha((ROOT/name).read_bytes())for name in runner.ASSETS};m['workflowSha256']=runner.sha(runner.WORKFLOW.read_bytes())
    runner.MANIFEST.write_text(json.dumps(m,indent=2)+'\n');runner.validate(allow_unsealed=not bool(args.source_pins))
    print(json.dumps({'status':'UNSEALED_PROSPECTIVE_PRODUCTION_STAGE_TRIAL'if not args.source_pins else 'SEALED_RETAINED_PRODUCTION_STAGE_TRIAL_ONLY','manifestSha256':runner.sha(runner.MANIFEST.read_bytes()),'sourceSha':m['sourceSha'],'accepted':False,'fullBoardRecovery':False,'qualityOrSpeedCredit':False}))


if __name__=='__main__':main()
