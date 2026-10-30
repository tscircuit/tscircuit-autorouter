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
MANIFEST=ROOT/'witness-relative-v2-srj18-trial-hotfix-20261030.json'
WORKFLOW=ROOT.parent.parent/'.github/workflows/witness-relative-v2-srj18-trial-hotfix-20261030.yml'
ASSETS=['witness-relative-v2-srj18-trial-20261030.json','run-witness-relative-v2-srj18-trial-hotfix.py','download-witness-relative-v2-srj18-original.py','seal-witness-relative-v2-srj18-trial-hotfix.py','tests/witness-relative-v2-srj18-original-transport.py','run-witness-relative-v2-srj18-trial.py','witness-relative-v2-srj18-child.ts','replay-witness-relative-v2-srj18-proof.py','seal-witness-relative-v2-srj18-trial.py','tests/witness-relative-v2-srj18-proof-replay.py','tests/witness-relative-v2-srj18-trial-integrity.py','tests/witness-relative-stage-proof-replay.py','replay-witness-relative-stage-proof.py','witness-local-repair-proposals.ts','run-witness-local-repair-diagnostic.py','witness-local-repair-diagnostic-20261029.json','run-witness-contact-diagnostic.py','witness-contact-diagnostic-20261029.json','witness-contact-raw-identity.json','run-bottleneck-experiments.py','install-pinned-dependencies.py','witness-quality6-artifact-carrier.py']
P9='lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/'
SOURCE_ASSETS={'stage':P9+'Pipeline9RelativeWitnessRepairSolver.ts','viaTraceTargets':P9+'getRelativeViaTraceTargets.ts','proof':P9+'provePipeline9RelativeContacts.ts','geometry':P9+'relativeCopperSweepGeometry.ts','certificate':P9+'getPipeline9WitnessViaCertificate.ts'}


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
    require(m['campaign']=='witness-relative-v2-srj18-trial-hotfix-20261030'and m['controllerBranch']=='codex/witness-relative-v2-srj18-trial-20261030','Wrong trial campaign/branch')
    for key in ['certificateRelative','certificateSha256','runner','bunVersion']:
        require(m[key]==old[key],'Qualified old source/input/runtime pin differs: '+key)
    require(m['sourceBaseSha']=='c9fd3d90b17fcb9dffe7a3b634823b982506f474'and m['sourceBaseTree']=='298c50207aae9aafb1e05acd6bd5ff996f6ba57c'and m['certificateBodySourceSha']==old['sourceSha'],'V2 source or exact old certificate body base differs')
    require(m['inheritedControllerLocal']=='144332d0141a8a5cae25064d7a0446cb6240735d'and m['inheritedControllerTree']=='0fd28043ea4c8dd47711bea558919aca9355c328'and m['expectedRemoteParent']=='abe016ce41bf3c67d8e90383a4896cc9ea077032','Inherited controller changed')
    require(m['retainedCase']=='srj18:11'and m['inputArm']=='B'and m['inputRoutedSourceSha']=='5d5500e3da02a7b1ed3eec74fc262f31c04f47df'and m['inputRoutedSourceTree']=='7a5f248d5772307119c7856f732849dd4e03f120','Input must be exact MAIN MST18 B, not stable-order or rerouted output')
    require(m['inputIdentitySha256']==sha(json.dumps({k:m[k]for k in ['inputArtifact','inputMembers']},sort_keys=True,separators=(',',':')).encode())=='213d09e87a3a6c1c50f39169e53e089e18130ab78c7c6032026fd13d8f19a54a','Exact main-MST original ZIP/member identity differs')
    require(m['inputQualificationPins']=={'originalRawQualificationSha256':'1faf8c27ae3dd34f3359652c147d45afdbe7a2c0c91c1997cbf907ecba08ac14','independentRawReviewSha256':'2d0305a72997d0cda3809245ea9dd293e847f11adc3f9467aad53c613d06a2c6'},'Original main-MST raw qualification differs')
    require(m['expectedBaselineCertificateSha256']is None and m['baselineCertificateHashPolicy']=='MEASURED_ON_BLACKSMITH_FULL_OLD_BODY_RETURN_NO_PREDECLARED_HASH','Unmeasured18 baseline must not receive an invented certificate pin')
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
        require({k:m['sourceFileHashes'][k]for k in ['proof','geometry','certificate']}=={'proof':'8e992acc9d28bc591c2ce798339cc684e00b57a4f2cd2a47044686a6d5c7bd40','geometry':'d1d5ada4c4dc5c76aca51b5bb7039ebeb01d440b91d2b860d697249ce886189c','certificate':'99d19f25ee9ddb4b66e41116aaf90b75437d2a322f8c50593bf54c28d0d69cae'},'V2 may add witness proposals but must retain the reviewed same relative theorem, bounds and old certificate')
        expected_ref=m['sourceSha']
    transport=load('main_mst_transport_pin_validation',ROOT/'download-witness-relative-v2-srj18-original.py')
    require(m['inputSourceRun']==transport.EXPECTED_RUN and m['hotfixInheritedLocal']=='60b53d120295fd7f87e68559e2360fef02664552'and m['hotfixInheritedTree']=='2e0cd14f36a6cc8d7482bf23d4bae30f3a59375d'and m['hotfixExpectedRemoteParent']=='6b805bc9ce4fa7a54303a060f190d7652b149d7d','Hotfix source run or inherited controller pin differs')
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
    carrier=load('retained_stage_original_artifact_transport',ROOT/'witness-quality6-artifact-carrier.py');transport=load('exact_main_mst_original_input',ROOT/'download-witness-relative-v2-srj18-original.py');proof=transport.download(m,output,carrier.GitHubClient(os.environ.get('GITHUB_TOKEN')))
    certificate=source/m['certificateRelative'];new_bytes=certificate.read_bytes();old_bytes=strip_visibility_exports(new_bytes.decode()).encode()
    require(sha(old_bytes)==m['certificateSha256'],'Old certificate function/predicates differ beyond the two export visibility prefixes')
    independent=certificate.with_name('getPipeline9WitnessViaCertificate.source2109.ts');require(not independent.exists(),'Fresh exact-old certificate copy required');independent.write_bytes(old_bytes)
    version=subprocess.check_output(['bun','--version'],text=True).strip();require(version==m['bunVersion'],'Bun differs')
    child=subprocess.run(['bun','--tsconfig-override',str(source/'tsconfig.json'),str(ROOT/'witness-relative-v2-srj18-child.ts'),str(source),str(output),'retained'],cwd=source,capture_output=True,text=True,timeout=300)
    (output/'child.stdout').write_text(child.stdout);(output/'child.stderr').write_text(child.stderr)
    require((output/'production-stage-trial.json').exists(),'Actual production stage child failed before a complete retained diagnostic; exact stdout/stderr retained')
    normal_completion=child.returncode==0
    trial=json.loads((output/'production-stage-trial.json').read_bytes())
    require(trial['before']['summary']['status']=='UNKNOWN'and trial['before']['summary']['foreignViaTraceFindings']==1 and trial['before']['summary']['foreignViaPadFindings']==0 and re.fullmatch('[0-9a-f]{64}',trial['before']['fullCertificateSha256']),'Measured old-body main-MST before certificate is absent or wrong defect class')
    require(trial['productionStage']['baselineCertificateMatchesIndependentBefore']is True and trial['productionStage']['finalCertificateMatchesIndependentAfter']is True,'Both complete old-body returns must deep-equal new stage returns')
    require(trial['stageSolveCalls']==trial['productionStage']['solveCalls']==1 and trial['productionStage']['className']==m['sourceApi']['className'],'Actual production stage solve was bypassed')
    require(trial['inputBytesUnchanged']is True and trial['routingExecutions']==0 and all(trial[k]is False for k in ['accepted','fullBoardRecovery','qualityOrSpeedCredit']),'Trial input/scope invariants differ')
    if normal_completion:
        replay=subprocess.run(['python3',str(ROOT/'replay-witness-relative-v2-srj18-proof.py'),'--output',str(output)],capture_output=True,text=True,timeout=120)
        (output/'replay.stdout').write_text(replay.stdout);(output/'replay.stderr').write_text(replay.stderr);require(replay.returncode==0,'Independent data-only relative proof rejected production output; retained without credit')
        replay_value=json.loads((output/'independent-relative-proof-replay.json').read_bytes())
        require(replay_value['status']in ['PASS_INDEPENDENT_RELATIVE_SAME_OWNER_ORIGINAL_TERMINAL_PARTITION_REPLAY','NO_LOCAL_REPAIR_OUTPUT_UNCHANGED'],'Unknown independent replay status')
        if trial['localRepair']['applied']:require(len(replay_value['mutableBundles'])==1 and replay_value['actualMovedRawPointCount']==3 and len(replay_value['mutableBundles'][0]['fixedBoundaries'])==2,'Main-MST trial requires a single coupled via-only bundle with two fixed fanout boundaries')
    else:
        replay_value={'status':'NOT_RUN_UNEXPECTED_PRODUCTION_STAGE_ERROR','sourceStageCompletedNormally':False,'accepted':False,'fullBoardRecovery':False,'qualityOrSpeedCredit':False}
        (output/'independent-relative-proof-replay.json').write_text(json.dumps(replay_value,indent=2)+'\n')
    require(not trial['localRepair']['applied']or replay_value['status']=='PASS_INDEPENDENT_RELATIVE_SAME_OWNER_ORIGINAL_TERMINAL_PARTITION_REPLAY','Changed production output lacks independent relative proof')
    require(certificate.read_bytes()==new_bytes and independent.read_bytes()==old_bytes and not git('diff','--name-only')and not git('diff','--cached','--name-only'),'Tracked production source or exact independent copy changed')
    proof.update(status='PASS_RETAINED_PRODUCTION_STAGE_EXECUTION_ONLY'if normal_completion else 'FAIL_UNEXPECTED_PRODUCTION_STAGE_ERROR_RETAINED_WITHOUT_CREDIT',sourceStageCompletedNormally=normal_completion,childReturncode=child.returncode,sourceSha=m['sourceSha'],sourceTree=m['sourceTree'],sourceBaseSha=m['sourceBaseSha'],sourceFileHashes=m['sourceFileHashes'],sourceReceiptPins=m['sourceReceiptPins'],retainedCase=m['retainedCase'],inputArm=m['inputArm'],inputRoutedSourceSha=m['inputRoutedSourceSha'],inputRoutedSourceTree=m['inputRoutedSourceTree'],inputQualificationPins=m['inputQualificationPins'],baselineCertificateHashWasPredeclared=False,manifestSha256=sha(MANIFEST.read_bytes()),original2109CertificateSha256=sha(old_bytes),newCertificateVisibilityMaskRevertsToExact2109=True,productionTrackedSourceUnchanged=True,bunVersion=version,runId=os.environ.get('GITHUB_RUN_ID'),controllerSha=os.environ.get('GITHUB_SHA'),productionStageTrialSha256=sha((output/'production-stage-trial.json').read_bytes()),independentReplaySha256=sha((output/'independent-relative-proof-replay.json').read_bytes()),productionStageSolveCalls=1,routingExecutions=0,accepted=False,qualityOrSpeedCredit=False,fullBoardRecovery=False)
    (output/'provenance.json').write_text(json.dumps(proof,indent=2)+'\n')
    payload=json.dumps({'provenance':proof,'productionStageTrial':trial,'independentRelativeReplay':replay_value},separators=(',',':')).encode();compressed=gzip.compress(payload,mtime=0);encoded=base64.b64encode(compressed).decode()
    print('WITNESS_RELATIVE_V2_SRJ18_TRIAL_BEGIN '+json.dumps({'payloadSha256':sha(payload),'gzipSha256':sha(compressed),'payloadBytes':len(payload),'base64Chars':len(encoded),'chunks':(len(encoded)+8191)//8192,'productionStageSolveCalls':1,'retainedOnly':True}),flush=True)
    for index in range(0,len(encoded),8192):print('WITNESS_RELATIVE_V2_SRJ18_TRIAL_CHUNK '+json.dumps({'seq':index//8192,'data':encoded[index:index+8192]}),flush=True)
    print('WITNESS_RELATIVE_V2_SRJ18_TRIAL_END '+json.dumps({'payloadSha256':sha(payload),'productionStageSolveCalls':1,'sourceStageCompletedNormally':normal_completion,'localRepairApplied':trial['localRepair']['applied'],'independentRelativeReplayStatus':replay_value['status'],'beforeSummary':trial['before']['summary'],'afterSummary':trial['after']['summary'],'accepted':False,'qualityOrSpeedCredit':False,'fullBoardRecovery':False}),flush=True)
    require(normal_completion,'Unexpected production stage failure retained losslessly in authenticated frames; trial failed without credit')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['draft','plan','run'],required=True);parser.add_argument('--source',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args();m=validate(allow_unsealed=args.mode=='draft')
    if args.mode in ['draft','plan']:print(json.dumps({'status':'UNSEALED_PROSPECTIVE_PRODUCTION_STAGE_TRIAL'if m['sealState']=='UNSEALED'else 'SEALED_RETAINED_PRODUCTION_STAGE_TRIAL_ONLY','sourceSha':m['sourceSha'],'stageSolveCallsRequired':1,'routingExecutions':0,'accepted':False,'qualityOrSpeedCredit':False}))
    else:run(args,m)
