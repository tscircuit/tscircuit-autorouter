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
MANIFEST=ROOT/'witness-relative-v4-main18-trial-20261030.json'
WORKFLOW=ROOT.parent.parent/'.github/workflows/witness-relative-v4-main18-trial-20261030.yml'
ASSETS=['tests/relative-v4-detail-projection-controls.py','relative-v4-component-qualification.json','relative-v4-component-independent-review.json','replay-relative-v4-target-clearance.py','tests/relative-v4-target-clearance-controls.py','witness-relative-v2-srj18-trial-20261030.json', 'download-witness-relative-v2-srj18-original.py', 'tests/witness-relative-v2-srj18-original-transport.py', 'run-witness-relative-v2-srj18-trial.py', 'replay-witness-relative-v2-srj18-proof.py', 'seal-witness-relative-v2-srj18-trial.py', 'tests/witness-relative-v2-srj18-proof-replay.py', 'tests/witness-relative-v2-srj18-trial-integrity.py', 'tests/witness-relative-stage-proof-replay.py', 'replay-witness-relative-stage-proof.py', 'witness-local-repair-proposals.ts', 'run-witness-local-repair-diagnostic.py', 'witness-local-repair-diagnostic-20261029.json', 'run-witness-contact-diagnostic.py', 'witness-contact-diagnostic-20261029.json', 'witness-contact-raw-identity.json', 'run-bottleneck-experiments.py', 'install-pinned-dependencies.py', 'witness-quality6-artifact-carrier.py', 'run-witness-relative-v4-main18-trial.py', 'seal-witness-relative-v4-main18-trial.py', 'witness-relative-v4-main18-child.ts', 'replay-witness-relative-v4-main18-proof.py', 'tests/witness-relative-v4-main18-trial-integrity.py', 'tests/witness-relative-v4-main18-proof-replay.py', 'instrument-relative-v2-main18-component.py', 'relative-v4-untargeted-audit.py', 'tests/relative-v4-untargeted-audit-controls.py', 'relative-v4-source-qa.json', 'relative-v4-source-review.json', 'relative-v4-source-publication.json']
P9='lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/'
SOURCE_ASSETS={'targetClearance':P9+'checkPipeline9RelativeViaTraceClearance.ts','detailGetter':P9+'getPipeline9RelativeGeometryDetails.ts','preservation':P9+'preservePipeline9RelativeFindings.ts','stage':P9+'Pipeline9RelativeWitnessRepairSolver.ts','viaTraceTargets':P9+'getRelativeViaTraceTargets.ts','proof':P9+'provePipeline9RelativeContacts.ts','geometry':P9+'relativeCopperSweepGeometry.ts','certificate':P9+'getPipeline9WitnessViaCertificate.ts'}


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
    require(m['campaign']=='witness-relative-v4-main18-trial-20261030'and m['controllerBranch']=='codex/witness-relative-v4-main18-trial-20261030','Wrong trial campaign/branch')
    for key in ['certificateRelative','certificateSha256','runner','bunVersion']:
        require(m[key]==old[key],'Qualified old source/input/runtime pin differs: '+key)
    require(m['sourceBaseSha']=='78c9f2fd45bdb53953d4d9bd61100a8f5f52b1f9'and m['sourceBaseTree']=='8f3c07e567a0e2bb33dd094672e0700e50834569'and m['certificateBodySourceSha']==old['sourceSha'],'V2 source or exact old certificate body base differs')
    require(m['inheritedControllerLocal']=='11a830b0915e2ce7c6f4a11990657c90637d3889'and m['inheritedControllerTree']=='0dedf5c37701b5b302a10a3ef6608ad50b8c5422'and m['expectedRemoteParent']=='b278a3f61c070ee83f6990fc3b9a96de939a5594','Inherited controller changed')
    require(m['retainedCase']=='srj18:11'and m['inputArm']=='B'and m['inputRoutedSourceSha']=='5d5500e3da02a7b1ed3eec74fc262f31c04f47df'and m['inputRoutedSourceTree']=='7a5f248d5772307119c7856f732849dd4e03f120','Input must be exact MAIN MST18 B, not stable-order or rerouted output')
    require(m['inputIdentitySha256']==sha(json.dumps({k:m[k]for k in ['inputArtifact','inputMembers']},sort_keys=True,separators=(',',':')).encode())=='213d09e87a3a6c1c50f39169e53e089e18130ab78c7c6032026fd13d8f19a54a','Exact main-MST original ZIP/member identity differs')
    require(m['inputQualificationPins']=={'originalRawQualificationSha256':'1faf8c27ae3dd34f3359652c147d45afdbe7a2c0c91c1997cbf907ecba08ac14','independentRawReviewSha256':'2d0305a72997d0cda3809245ea9dd293e847f11adc3f9467aad53c613d06a2c6'},'Original main-MST raw qualification differs')
    require(m['expectedBaselineCertificateSha256']=='e7bbb4acf7c5d7ca21fe86c4937319cc6f9bc5768af27e38a0be852f80e0c2a1'and m['baselineCertificateHashPolicy']=='PRIOR_INDEPENDENTLY_QUALIFIED_ACTUAL18_OLD_BODY_RETURN','Unmeasured18 baseline must not receive an invented certificate pin')
    require(m.get('componentDiagnosticPrerequisite')=={'qualificationSha256':'51bd04c7ff4f80eadbe0dc5de3fd9bd51b04d7ff013f24e3b26d4e2c8679318b','independentReviewSha256':'b7bd16ca91e9286286931c891315abefe12ee980e85a3f02acf065a21e1b139f'},'Prior independently qualified component prerequisite differs')
    for name,key in [('relative-v4-component-qualification.json','qualificationSha256'),('relative-v4-component-independent-review.json','independentReviewSha256')]:require(sha((ROOT/name).read_bytes())==m['componentDiagnosticPrerequisite'][key],'Component prerequisite actual receipt bytes changed')
    component=json.loads((ROOT/'relative-v4-component-qualification.json').read_bytes());component_peer=json.loads((ROOT/'relative-v4-component-independent-review.json').read_bytes())
    require(component.get('runId')==component_peer.get('runId')=='40985834555'and component.get('independentComponentLeadCount')==6 and component.get('completeOriginalInstrumentedFullReturnsEqual')is True and component_peer.get('authorQualification',{}).get('sha256')==m['componentDiagnosticPrerequisite']['qualificationSha256']and component_peer.get('authorReceiptIndependentlyReproducedByteExact')is True and component.get('productionStageSolveCalls')==component_peer.get('productionStageSolveCalls')==0,'Component evidence is missing or promoted into actual production-stage credit')
    require(m['maximumCandidates']==16 and type(m['maximumCandidates'])is int and m['maximumStageIterations']==20 and m['maximumStageSolveCalls']==1 and m['viaMaximumMove']==.25 and m['wireMaximumMove']==.02,'Stage domain changed')
    require(m['sourceApi']=={'className':'Pipeline9RelativeWitnessRepairSolver','constructorFields':['originalSrj','pointPairs','traces','protectedTraces'],'solveMethod':'solve','outputMethod':'getOutput','pipelineFlag':'experimentRelativeWitnessRepair','defaultOff':True},'Production API/default-off contract changed')
    require(m.get('acceptanceMode')=='EXACT_UNTARGETED_FINDINGS'and m.get('expectedGlobalStatus')=='UNKNOWN'and m.get('expectedGlobalDemands')==139 and m.get('expectedGlobalReasonCount')==66 and m.get('expectedGeometryBefore')==8 and m.get('expectedGeometryAfterIfApplied')==7 and m.get('untargetedDetailedRecordMultisetsExact')is True and m.get('completeOriginalInstrumentedReturnEqualityRequired')is True,'Targeted preservation/full UNKNOWN scope changed')
    require(m.get('literalTargetClearanceContract')=={'minimumMm':.1,'allForeignTraceSharedManufacturedLayerSegments':True,'arithmetic':'EXACT_BINARY64_RATIONAL','noNativeToleranceCredit':True},'Literal all-target-segment clearance contract changed')
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
        for name,key in [('relative-v4-source-qa.json','authorQaSha256'),('relative-v4-source-review.json','independentReviewSha256'),('relative-v4-source-publication.json','publicationReceiptSha256')]:require(sha((ROOT/name).read_bytes())==m['sourceReceiptPins'][key],'Reviewed source receipt bytes changed')
        q=json.loads((ROOT/'relative-v4-source-qa.json').read_bytes());pub=json.loads((ROOT/'relative-v4-source-publication.json').read_bytes())
        require(q.get('tree')==m['sourceTree']and pub.get('remoteCommit')==m['sourceSha']and pub.get('tree')==m['sourceTree']and pub.get('localCommit')==q.get('localCommit')and pub.get('singleRemoteParent')==m['sourceBaseSha']and pub.get('qa',{}).get('sha256')==m['sourceReceiptPins']['authorQaSha256']and pub.get('peer',{}).get('sha256')==m['sourceReceiptPins']['independentReviewSha256']and pub.get('remoteCommitTreeSingleParentAndBranchGetVerified')is True and pub.get('defaultOff')is True,'Actual reviewed/published source tree and QA/peer receipt binding differs')
        require(m['sourceSha']!=m['sourceBaseSha']and m['sourceTree']!=m['sourceBaseTree'],'Trial does not use new production stage source')
        require(all(re.fullmatch('[0-9a-f]{64}',v)for v in [*m['sourceFileHashes'].values(),*m['sourceReceiptPins'].values()])and m['sourceDefaultOffReviewed']is True,'Source QA/review/publication/default-off pins absent')
        require({k:m['sourceFileHashes'][k]for k in ['proof','geometry','certificate']}=={'proof':'8e992acc9d28bc591c2ce798339cc684e00b57a4f2cd2a47044686a6d5c7bd40','geometry':'d1d5ada4c4dc5c76aca51b5bb7039ebeb01d440b91d2b860d697249ce886189c','certificate':'99d19f25ee9ddb4b66e41116aaf90b75437d2a322f8c50593bf54c28d0d69cae'},'V2 may add witness proposals but must retain the reviewed same relative theorem, bounds and old certificate')
        expected_ref=m['sourceSha']
    transport=load('main_mst_transport_pin_validation',ROOT/'download-witness-relative-v2-srj18-original.py')
    require(m['inputSourceRun']==transport.EXPECTED_RUN,'Exact original MAIN MST source run differs')
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
    independent=certificate.with_name('getPipeline9WitnessViaCertificate.source2109.ts');observed=certificate.with_name('getPipeline9WitnessViaCertificate.componentDiagnostic.ts');require(not independent.exists()and not observed.exists(),'Fresh exact-old and observed certificate copies required');independent.write_bytes(old_bytes)
    tap=load('retained_v3_transparent_old_predicates',ROOT/'instrument-relative-v2-main18-component.py');observed_bytes=tap.instrument(old_bytes.decode()).encode();require(tap.strip(observed_bytes.decode()).encode()==old_bytes,'Transparent taps changed old certificate bytes');observed.write_bytes(observed_bytes)
    version=subprocess.check_output(['bun','--version'],text=True).strip();require(version==m['bunVersion'],'Bun differs')
    child=subprocess.run(['bun','--tsconfig-override',str(source/'tsconfig.json'),str(ROOT/'witness-relative-v4-main18-child.ts'),str(source),str(output),'retained'],cwd=source,capture_output=True,text=True,timeout=300)
    (output/'child.stdout').write_text(child.stdout);(output/'child.stderr').write_text(child.stderr)
    require((output/'production-stage-trial.json').exists(),'Actual production stage child failed before a complete retained diagnostic; exact stdout/stderr retained')
    normal_completion=child.returncode==0
    trial=json.loads((output/'production-stage-trial.json').read_bytes())
    require(trial['before']['fullCertificateSha256']==m['expectedBaselineCertificateSha256']and trial['before']['summary']['status']=='UNKNOWN'and trial['before']['summary']['foreignViaTraceFindings']==1 and trial['before']['summary']['foreignViaPadFindings']==0 and re.fullmatch('[0-9a-f]{64}',trial['before']['fullCertificateSha256']),'Measured old-body main-MST before certificate is absent or wrong defect class')
    require(trial['productionStage']['baselineCertificateMatchesIndependentBefore']is True and trial['productionStage']['finalCertificateMatchesIndependentAfter']is True,'Both complete old-body returns must deep-equal new stage returns')
    require(trial['stageSolveCalls']==trial['productionStage']['solveCalls']==1 and trial['productionStage']['className']==m['sourceApi']['className'],'Actual production stage solve was bypassed')
    require(trial['inputBytesUnchanged']is True and trial['routingExecutions']==0 and all(trial[k]is False for k in ['accepted','fullBoardRecovery','qualityOrSpeedCredit']),'Trial input/scope invariants differ')
    if normal_completion:
        replay=subprocess.run(['python3',str(ROOT/'replay-witness-relative-v4-main18-proof.py'),'--output',str(output)],capture_output=True,text=True,timeout=120)
        (output/'replay.stdout').write_text(replay.stdout);(output/'replay.stderr').write_text(replay.stderr);require(replay.returncode==0,'Independent data-only relative proof rejected production output; retained without credit')
        replay_value=json.loads((output/'independent-relative-proof-replay.json').read_bytes())
        require(replay_value['status']in ['PASS_INDEPENDENT_RELATIVE_SAME_OWNER_ORIGINAL_TERMINAL_PARTITION_REPLAY','NO_LOCAL_REPAIR_OUTPUT_UNCHANGED'],'Unknown independent replay status')
        if trial['localRepair']['applied']:require(len(replay_value['mutableBundles'])==1 and replay_value['actualMovedRawPointCount']==3 and len(replay_value['mutableBundles'][0]['fixedBoundaries'])==2,'Main-MST trial requires a single coupled via-only bundle with two fixed fanout boundaries')
    else:
        replay_value={'status':'NOT_RUN_UNEXPECTED_PRODUCTION_STAGE_ERROR','sourceStageCompletedNormally':False,'accepted':False,'fullBoardRecovery':False,'qualityOrSpeedCredit':False}
        (output/'independent-relative-proof-replay.json').write_text(json.dumps(replay_value,indent=2)+'\n')
    preservation=load('retained_v3_independent_untargeted_audit',ROOT/'relative-v4-untargeted-audit.py').audit(trial)
    require(preservation['status']=='PASS_EXACT_UNTARGETED_FINDING_PRESERVATION'if trial['localRepair']['applied']else preservation['status']=='NO_LOCAL_REPAIR_OUTPUT_UNCHANGED','Targeted detailed finding audit failed')
    target_margin=load('retained_v4_exact_literal_target_margin',ROOT/'replay-relative-v4-target-clearance.py').audit(json.loads((output/'original-input.json').read_bytes()),json.loads((output/'raw-new-traces.json').read_bytes()),json.loads((output/'production-stage-output-traces.json').read_bytes()),trial)
    require(not trial['localRepair']['applied']or replay_value['status']=='PASS_INDEPENDENT_RELATIVE_SAME_OWNER_ORIGINAL_TERMINAL_PARTITION_REPLAY','Changed production output lacks independent relative proof')
    require(certificate.read_bytes()==new_bytes and independent.read_bytes()==old_bytes and observed.read_bytes()==observed_bytes and tap.strip(observed.read_text()).encode()==old_bytes and not git('diff','--name-only')and not git('diff','--cached','--name-only'),'Tracked production source or exact independent copy changed')
    proof.update(status='PASS_RETAINED_PRODUCTION_STAGE_EXECUTION_ONLY'if normal_completion else 'FAIL_UNEXPECTED_PRODUCTION_STAGE_ERROR_RETAINED_WITHOUT_CREDIT',sourceStageCompletedNormally=normal_completion,childReturncode=child.returncode,sourceSha=m['sourceSha'],sourceTree=m['sourceTree'],sourceBaseSha=m['sourceBaseSha'],sourceFileHashes=m['sourceFileHashes'],sourceReceiptPins=m['sourceReceiptPins'],retainedCase=m['retainedCase'],inputArm=m['inputArm'],inputRoutedSourceSha=m['inputRoutedSourceSha'],inputRoutedSourceTree=m['inputRoutedSourceTree'],inputQualificationPins=m['inputQualificationPins'],baselineCertificateHashWasPredeclared=True,manifestSha256=sha(MANIFEST.read_bytes()),original2109CertificateSha256=sha(old_bytes),observedCertificateSha256=sha(observed_bytes),observationsStripByteExactlyToOld2109=True,newCertificateVisibilityMaskRevertsToExact2109=True,productionTrackedSourceUnchanged=True,bunVersion=version,runId=os.environ.get('GITHUB_RUN_ID'),controllerSha=os.environ.get('GITHUB_SHA'),productionStageTrialSha256=sha((output/'production-stage-trial.json').read_bytes()),independentReplaySha256=sha((output/'independent-relative-proof-replay.json').read_bytes()),productionStageSolveCalls=1,routingExecutions=0,accepted=False,qualityOrSpeedCredit=False,fullBoardRecovery=False)
    (output/'provenance.json').write_text(json.dumps(proof,indent=2)+'\n')
    payload=json.dumps({'provenance':proof,'productionStageTrial':trial,'independentRelativeReplay':replay_value,'independentUntargetedPreservation':preservation,'independentLiteralTargetClearance':target_margin},separators=(',',':')).encode();compressed=gzip.compress(payload,mtime=0);encoded=base64.b64encode(compressed).decode()
    print('WITNESS_RELATIVE_V4_MAIN18_TRIAL_BEGIN '+json.dumps({'payloadSha256':sha(payload),'gzipSha256':sha(compressed),'payloadBytes':len(payload),'base64Chars':len(encoded),'chunks':(len(encoded)+8191)//8192,'productionStageSolveCalls':1,'retainedOnly':True}),flush=True)
    for index in range(0,len(encoded),8192):print('WITNESS_RELATIVE_V4_MAIN18_TRIAL_CHUNK '+json.dumps({'seq':index//8192,'data':encoded[index:index+8192]}),flush=True)
    print('WITNESS_RELATIVE_V4_MAIN18_TRIAL_END '+json.dumps({'payloadSha256':sha(payload),'productionStageSolveCalls':1,'sourceStageCompletedNormally':normal_completion,'localRepairApplied':trial['localRepair']['applied'],'independentRelativeReplayStatus':replay_value['status'],'beforeSummary':trial['before']['summary'],'afterSummary':trial['after']['summary'],'accepted':False,'qualityOrSpeedCredit':False,'fullBoardRecovery':False}),flush=True)
    require(target_margin['status']in['PASS_LITERAL_TARGET_CLEARANCE_ALL_MANUFACTURED_LAYERS','NO_LOCAL_REPAIR_OUTPUT_UNCHANGED'],'Exact final target margin failed; complete stage/proof/untargeted evidence retained in authenticated frames without credit')
    require(normal_completion,'Unexpected production stage failure retained losslessly in authenticated frames; trial failed without credit')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['draft','plan','run'],required=True);parser.add_argument('--source',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args();m=validate(allow_unsealed=args.mode=='draft')
    if args.mode in ['draft','plan']:print(json.dumps({'status':'UNSEALED_PROSPECTIVE_PRODUCTION_STAGE_TRIAL'if m['sealState']=='UNSEALED'else 'SEALED_RETAINED_PRODUCTION_STAGE_TRIAL_ONLY','sourceSha':m['sourceSha'],'stageSolveCallsRequired':1,'routingExecutions':0,'accepted':False,'qualityOrSpeedCredit':False}))
    else:run(args,m)
