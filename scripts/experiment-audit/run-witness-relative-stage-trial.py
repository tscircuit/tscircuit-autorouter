#!/usr/bin/env python3
"""One actual production local-stage solve and independent retained-data proof.

Drafts remain UNSEALED and cannot run. Routing and local actual-data predicates
are forbidden; only the Blacksmith job may execute the source stage/checkers.
"""
import argparse
import base64
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parent
MANIFEST=ROOT/'witness-relative-stage-trial-20261029.json'
WORKFLOW=ROOT.parent.parent/'.github/workflows/witness-relative-stage-trial-20261029.yml'
ASSETS=['run-witness-relative-stage-trial.py','witness-relative-stage-child.ts','replay-witness-relative-stage-proof.py','seal-witness-relative-stage-trial.py','tests/witness-relative-stage-proof-replay.py','tests/witness-relative-stage-trial-integrity.py','witness-local-repair-proposals.ts','run-witness-local-repair-diagnostic.py','witness-local-repair-diagnostic-20261029.json','run-witness-contact-diagnostic.py','witness-contact-diagnostic-20261029.json','witness-contact-raw-identity.json','run-bottleneck-experiments.py','install-pinned-dependencies.py','witness-quality6-artifact-carrier.py']
P9='lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/'
SOURCE_ASSETS={'stage':P9+'Pipeline9RelativeWitnessRepairSolver.ts','proof':P9+'provePipeline9RelativeContacts.ts','geometry':P9+'relativeCopperSweepGeometry.ts','certificate':P9+'getPipeline9WitnessViaCertificate.ts'}


def require(value,message):
    if not value:raise ValueError(message)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

base=load('retained_stage_original_input_loader',ROOT/'run-witness-contact-diagnostic.py')


def strip_visibility_exports(value):
    for name in ['collectRawViaSites','checkBoardEnvelope']:
        before='export function '+name+'(';after='function '+name+'('
        require(value.count(before)==1 and value.count(after)==1,'Expected exactly one certificate visibility export: '+name)
        value=value.replace(before,after)
    return value


def validate(value=None,allow_unsealed=False):
    m=json.loads(MANIFEST.read_bytes())if value is None else value;old=base.validate()
    require(m['campaign']=='witness-relative-stage-trial-20261029'and m['controllerBranch']=='codex/witness-relative-stage-trial-20261029','Wrong trial campaign/branch')
    for key in ['certificateRelative','certificateSha256','inputArtifact','inputMembers','inputIdentitySha256','expectedCertificateSummary','runner','bunVersion']:
        require(m[key]==old[key],'Qualified old source/input/runtime pin differs: '+key)
    require(m['sourceBaseSha']==old['sourceSha']and m['sourceBaseTree']==old['sourceTree'],'New source is not based on qualified2109')
    require(m['inheritedControllerLocal']=='fac9cf15c9a16d50da272be5ca34ec2cbc9880dd'and m['inheritedControllerTree']=='50d71f441a29ddcf0ed4e67d89da731230798552'and m['expectedRemoteParent']=='52948c4f0955a102c8d52995e4a1ac2b08488415','Inherited controller changed')
    require(m['expectedBaselineCertificateSha256']=='0b5243f76bc3a3e0aa84001d6657d13d99d5d624e14de1436652aaef923ea2ad','Full baseline pin changed')
    require(m['maximumCandidates']==16 and type(m['maximumCandidates'])is int and m['maximumStageIterations']==20 and m['maximumStageSolveCalls']==1 and m['viaMaximumMove']==.25 and m['wireMaximumMove']==.02,'Stage domain changed')
    require(m['sourceApi']=={'className':'Pipeline9RelativeWitnessRepairSolver','constructorFields':['originalSrj','pointPairs','traces','protectedTraces'],'solveMethod':'solve','outputMethod':'getOutput','pipelineFlag':'experimentRelativeWitnessRepair','defaultOff':True},'Production API/default-off contract changed')
    require(m['certificateVisibilityExports']==['collectRawViaSites','checkBoardEnvelope'],'Certificate body mask changed')
    require(m['productionStageSolveRequired']is True and m['independentBlacksmithDataOnlyReplayRequired']is True and m['localRelativeRepairAllowed']is True,'Actual source stage/replay cannot be bypassed')
    require(all(m[k]is False for k in ['routingAllowed','localDatasetCheckerAllowed','qualityOrSpeedCredit','productionAcceptanceAllowed','fullBoardRecoveryClaim']),'Trial gained forbidden scope')
    require(set(m['sourceFileHashes'])==set(SOURCE_ASSETS),'Source asset set differs')
    require(set(m['sourceReceiptPins'])=={'authorQaSha256','independentReviewSha256','publicationReceiptSha256'},'Source review/publication receipt set differs')
    if m['sealState']=='UNSEALED':
        require(allow_unsealed,'UNSEALED prospective trial cannot run or publish as ready')
        require(m['sourceSha']==m['sourceTree']=='UNSEALED'and all(v=='UNSEALED'for v in m['sourceFileHashes'].values())and all(v=='UNSEALED'for v in m['sourceReceiptPins'].values())and m['sourceDefaultOffReviewed']is False,'Prospective placeholders changed without full source sealing')
        expected_ref='UNSEALED_SOURCE_SHA_DO_NOT_RUN'
    else:
        require(m['sealState']=='SEALED'and re.fullmatch('[0-9a-f]{40}',m['sourceSha'])and re.fullmatch('[0-9a-f]{40}',m['sourceTree']),'Invalid sealed source')
        require(m['sourceSha']!=m['sourceBaseSha']and m['sourceTree']!=m['sourceBaseTree'],'Trial does not use new production stage source')
        require(all(re.fullmatch('[0-9a-f]{64}',v)for v in [*m['sourceFileHashes'].values(),*m['sourceReceiptPins'].values()])and m['sourceDefaultOffReviewed']is True,'Source QA/review/publication/default-off pins absent')
        expected_ref=m['sourceSha']
    workflow=WORKFLOW.read_text()
    require(workflow.count('          ref: '+expected_ref+'\n')==1,'Workflow source checkout differs from sealed trial')
    require(m.get('assetHashes')=={name:sha((ROOT/name).read_bytes())for name in ASSETS}and m.get('workflowSha256')==sha(WORKFLOW.read_bytes()),'Sealed trial controller bytes differ')
    return m


def run(args,m):
    require(os.environ.get('GITHUB_ACTIONS')=='true'and os.environ.get('GITHUB_EVENT_NAME')=='push'and os.environ.get('GITHUB_REF_NAME')==m['controllerBranch']and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Actual retained-stage execution is first-push Blacksmith-only')
    source=args.source.resolve();output=args.output.resolve();require(not output.exists(),'Fresh trial output required');output.mkdir(parents=True)
    git=lambda *values:subprocess.check_output(['git','-C',str(source),*values],text=True).strip()
    require(git('rev-parse','HEAD')==m['sourceSha']and git('rev-parse','HEAD^{tree}')==m['sourceTree']and not git('diff','--name-only')and not git('diff','--cached','--name-only'),'Qualified new production tree differs')
    for key,relative in SOURCE_ASSETS.items():require(sha((source/relative).read_bytes())==m['sourceFileHashes'][key],'Pinned production source file differs: '+key)
    common=load('retained_stage_pinned_dependencies',ROOT/'run-bottleneck-experiments.py');authority=common.validate_manifest(ROOT/'bottleneck-experiments-20261029.json');common.verify_dependencies(authority,{'A':source,'B':source})
    carrier=load('retained_stage_original_artifact_transport',ROOT/'witness-quality6-artifact-carrier.py');proof=base.download(base.validate(),output,carrier.GitHubClient(os.environ.get('GITHUB_TOKEN')))
    certificate=source/m['certificateRelative'];new_bytes=certificate.read_bytes();old_bytes=strip_visibility_exports(new_bytes.decode()).encode()
    require(sha(old_bytes)==m['certificateSha256'],'Old certificate function/predicates differ beyond the two export visibility prefixes')
    independent=certificate.with_name('getPipeline9WitnessViaCertificate.source2109.ts');require(not independent.exists(),'Fresh exact-old certificate copy required');independent.write_bytes(old_bytes)
    version=subprocess.check_output(['bun','--version'],text=True).strip();require(version==m['bunVersion'],'Bun differs')
    child=subprocess.run(['bun','--tsconfig-override',str(source/'tsconfig.json'),str(ROOT/'witness-relative-stage-child.ts'),str(source),str(output),'retained'],cwd=source,capture_output=True,text=True,timeout=300)
    (output/'child.stdout').write_text(child.stdout);(output/'child.stderr').write_text(child.stderr)
    require((output/'production-stage-trial.json').exists(),'Actual production stage child failed before a complete retained diagnostic; exact stdout/stderr retained')
    normal_completion=child.returncode==0
    trial=json.loads((output/'production-stage-trial.json').read_bytes())
    require(trial['before']['summary']==m['expectedCertificateSummary']and trial['before']['fullCertificateSha256']==m['expectedBaselineCertificateSha256'],'Exact old full baseline reproduction differs')
    require(trial['stageSolveCalls']==trial['productionStage']['solveCalls']==1 and trial['productionStage']['className']==m['sourceApi']['className'],'Actual production stage solve was bypassed')
    require(trial['inputBytesUnchanged']is True and trial['routingExecutions']==0 and all(trial[k]is False for k in ['accepted','fullBoardRecovery','qualityOrSpeedCredit']),'Trial input/scope invariants differ')
    if normal_completion:
        replay=subprocess.run(['python3',str(ROOT/'replay-witness-relative-stage-proof.py'),'--output',str(output)],capture_output=True,text=True,timeout=120)
        (output/'replay.stdout').write_text(replay.stdout);(output/'replay.stderr').write_text(replay.stderr);require(replay.returncode==0,'Independent data-only relative proof rejected production output; retained without credit')
        replay_value=json.loads((output/'independent-relative-proof-replay.json').read_bytes())
        require(replay_value['status']in ['PASS_INDEPENDENT_RELATIVE_SAME_OWNER_ORIGINAL_TERMINAL_PARTITION_REPLAY','NO_LOCAL_REPAIR_OUTPUT_UNCHANGED'],'Unknown independent replay status')
    else:
        replay_value={'status':'NOT_RUN_UNEXPECTED_PRODUCTION_STAGE_ERROR','sourceStageCompletedNormally':False,'accepted':False,'fullBoardRecovery':False,'qualityOrSpeedCredit':False}
        (output/'independent-relative-proof-replay.json').write_text(json.dumps(replay_value,indent=2)+'\n')
    require(not trial['localRepair']['applied']or replay_value['status']=='PASS_INDEPENDENT_RELATIVE_SAME_OWNER_ORIGINAL_TERMINAL_PARTITION_REPLAY','Changed production output lacks independent relative proof')
    require(certificate.read_bytes()==new_bytes and independent.read_bytes()==old_bytes and not git('diff','--name-only')and not git('diff','--cached','--name-only'),'Tracked production source or exact independent copy changed')
    proof.update(status='PASS_RETAINED_PRODUCTION_STAGE_EXECUTION_ONLY'if normal_completion else 'FAIL_UNEXPECTED_PRODUCTION_STAGE_ERROR_RETAINED_WITHOUT_CREDIT',sourceStageCompletedNormally=normal_completion,childReturncode=child.returncode,sourceSha=m['sourceSha'],sourceTree=m['sourceTree'],sourceBaseSha=m['sourceBaseSha'],sourceFileHashes=m['sourceFileHashes'],sourceReceiptPins=m['sourceReceiptPins'],manifestSha256=sha(MANIFEST.read_bytes()),original2109CertificateSha256=sha(old_bytes),newCertificateVisibilityMaskRevertsToExact2109=True,productionTrackedSourceUnchanged=True,bunVersion=version,runId=os.environ.get('GITHUB_RUN_ID'),controllerSha=os.environ.get('GITHUB_SHA'),productionStageTrialSha256=sha((output/'production-stage-trial.json').read_bytes()),independentReplaySha256=sha((output/'independent-relative-proof-replay.json').read_bytes()),productionStageSolveCalls=1,routingExecutions=0,accepted=False,qualityOrSpeedCredit=False,fullBoardRecovery=False)
    (output/'provenance.json').write_text(json.dumps(proof,indent=2)+'\n')
    payload=json.dumps({'provenance':proof,'productionStageTrial':trial,'independentRelativeReplay':replay_value},separators=(',',':')).encode();compressed=gzip.compress(payload,mtime=0);encoded=base64.b64encode(compressed).decode()
    print('WITNESS_RELATIVE_STAGE_TRIAL_BEGIN '+json.dumps({'payloadSha256':sha(payload),'gzipSha256':sha(compressed),'payloadBytes':len(payload),'base64Chars':len(encoded),'chunks':(len(encoded)+8191)//8192,'productionStageSolveCalls':1,'retainedOnly':True}),flush=True)
    for index in range(0,len(encoded),8192):print('WITNESS_RELATIVE_STAGE_TRIAL_CHUNK '+json.dumps({'seq':index//8192,'data':encoded[index:index+8192]}),flush=True)
    print('WITNESS_RELATIVE_STAGE_TRIAL_END '+json.dumps({'payloadSha256':sha(payload),'productionStageSolveCalls':1,'sourceStageCompletedNormally':normal_completion,'localRepairApplied':trial['localRepair']['applied'],'independentRelativeReplayStatus':replay_value['status'],'beforeSummary':trial['before']['summary'],'afterSummary':trial['after']['summary'],'accepted':False,'qualityOrSpeedCredit':False,'fullBoardRecovery':False}),flush=True)
    require(normal_completion,'Unexpected production stage failure retained losslessly in authenticated frames; trial failed without credit')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['draft','plan','run'],required=True);parser.add_argument('--source',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args();m=validate(allow_unsealed=args.mode=='draft')
    if args.mode in ['draft','plan']:print(json.dumps({'status':'UNSEALED_PROSPECTIVE_PRODUCTION_STAGE_TRIAL'if m['sealState']=='UNSEALED'else 'SEALED_RETAINED_PRODUCTION_STAGE_TRIAL_ONLY','sourceSha':m['sourceSha'],'stageSolveCallsRequired':1,'routingExecutions':0,'accepted':False,'qualityOrSpeedCredit':False}))
    else:run(args,m)
