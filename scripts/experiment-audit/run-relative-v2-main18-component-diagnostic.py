#!/usr/bin/env python3
"""Untouched retained predicates, transparent observations and bounded proposals."""
import argparse
import base64
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parent
MANIFEST=ROOT/'relative-v2-main18-component-diagnostic-20261030.json'
WORKFLOW=ROOT.parent.parent/'.github/workflows/relative-v2-main18-component-diagnostic-20261030.yml'
ASSETS=['run-relative-v2-main18-component-diagnostic.py','seal-relative-v2-main18-component-diagnostic.py','instrument-relative-v2-main18-component.py','relative-v2-main18-component-child.ts','replay-relative-v2-main18-component-proof.py','tests/relative-v2-main18-component-controls.py','tests/relative-v2-main18-component-proof-controls.py','run-witness-relative-v2-srj18-trial-hotfix.py','witness-relative-v2-srj18-trial-hotfix-20261030.json','download-witness-relative-v2-srj18-original.py','witness-local-repair-proposals.ts','witness-quality6-artifact-carrier.py','run-bottleneck-experiments.py','install-pinned-dependencies.py']


def require(value,message):
    if not value:raise ValueError(message)


def sha(raw):return hashlib.sha256(raw).hexdigest()
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

prior=load('frozen_retained_main18_stage_controller',ROOT/'run-witness-relative-v2-srj18-trial-hotfix.py')
tap=load('transparent_main18_predicate_observations',ROOT/'instrument-relative-v2-main18-component.py')


def validate(value=None):
    previous=prior.validate();m=json.loads(MANIFEST.read_bytes())if value is None else value
    require(m['campaign']=='relative-v2-main18-component-diagnostic-20261030'and m['controllerBranch']=='codex/relative-v2-main18-component-diagnostic-20261030','Wrong diagnostic namespace')
    require(sha(prior.MANIFEST.read_bytes())==m['inheritedManifestSha256']=='3f49ba6c6e498771f1fd60ebeef30363df0f50f3e60c68c46d0c52a8894cd825','Inherited frozen controller manifest differs')
    for key in ['sourceSha','sourceTree','sourceBaseSha','sourceFileHashes','sourceReceiptPins','sourceDefaultOffReviewed','certificateRelative','certificateSha256','runner','bunVersion','inputArtifact','inputMembers','inputSourceRun','inputRoutedSourceSha','inputRoutedSourceTree','inputQualificationPins','inputIdentitySha256']:
        require(m[key]==previous[key],'Published source or exact original input differs: '+key)
    require(m['sourceSha']=='ed7301ad717238118619e374972c19c40d2bc3ec'and m['sourceTree']=='0035e7b6a849b5e37aa782fb769c32a1aa8f1242','Only published reviewed V2 source is permitted')
    require(m['inheritedLocal']=='63f0c7bebeae77462b08900997b995d7bc8e2100'and m['inheritedTree']=='1db33a77f360180a4446c7f40929b7786214e199'and m['expectedRemoteParent']=='0007038a546f092e0d5be1695901272e7d4ac054','Inherited diagnostic tree/remote parent differs')
    require(m['baselineCertificateSha256']=='e7bbb4acf7c5d7ca21fe86c4937319cc6f9bc5768af27e38a0be852f80e0c2a1'and m['negativeActualQualificationSha256']=='9619bf7d9d2145f2553de1f1c0749ab9dde568047d6f45af5a3fd8839cfcbce3'and m['negativeActualIndependentReviewSha256']=='219828a4d66a5d454ce509b1a1f3acbd4ccca5046b82b38aff03b9aaa580b875','Actual old-body baseline binding differs')
    require(type(m['maximumCandidates'])is int and m['maximumCandidates']==16 and m['maximumConceptualSteps']==20 and m['viaMaximumMove']==.25 and m['wireMaximumMove']==.02,'Component portfolio/caps differ')
    require(m['stageSolveCalls']==0 and all(m[k]is False for k in ['routingAllowed','localDatasetCheckerAllowed','productionAcceptanceAllowed','fullBoardRecoveryClaim','qualityOrSpeedCredit','productionStageCredit']),'Diagnostic gained a forbidden claim/execution')
    require(all(m[k]is True for k in ['completeOriginalInstrumentedReturnEqualityRequired','detailedUntargetedFindingMultisetsExact','publishedV2ProposalHelperRequired','samePublishedRelativeProofRequired','independentBlacksmithDataOnlyReplayRequired']),'Required component evidence disabled')
    require(m['assetHashes']=={name:sha((ROOT/name).read_bytes())for name in ASSETS}and m['workflowSha256']==sha(WORKFLOW.read_bytes()),'Diagnostic sealed bytes differ')
    require(WORKFLOW.read_text().count('          ref: '+m['sourceSha']+'\n')==1,'Published V2 checkout pin differs')
    return m


def run(args,m):
    require(os.environ.get('GITHUB_ACTIONS')=='true'and os.environ.get('GITHUB_EVENT_NAME')=='push'and os.environ.get('GITHUB_REF_NAME')==m['controllerBranch']and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Actual retained component diagnostic is first-push Blacksmith-only')
    source=args.source.resolve();output=args.output.resolve();require(not output.exists(),'Fresh component output required');output.mkdir(parents=True)
    git=lambda *values:subprocess.check_output(['git','-C',str(source),*values],text=True).strip()
    require(git('rev-parse','HEAD')==m['sourceSha']and git('rev-parse','HEAD^{tree}')==m['sourceTree']and not git('diff','--name-only')and not git('diff','--cached','--name-only'),'Published production source checkout differs')
    for key,relative in prior.SOURCE_ASSETS.items():require(sha((source/relative).read_bytes())==m['sourceFileHashes'][key],'Published source asset differs: '+key)
    common=load('component_pinned_dependencies',ROOT/'run-bottleneck-experiments.py');authority=common.validate_manifest(ROOT/'bottleneck-experiments-20261029.json');common.verify_dependencies(authority,{'A':source,'B':source})
    carrier=load('component_original_http_client',ROOT/'witness-quality6-artifact-carrier.py');transport=load('component_exact_main_mst_transport',ROOT/'download-witness-relative-v2-srj18-original.py')
    provenance=transport.download(m,output,carrier.GitHubClient(os.environ.get('GITHUB_TOKEN')))
    certificate=source/m['certificateRelative'];production_bytes=certificate.read_bytes();old_bytes=prior.strip_visibility_exports(production_bytes.decode()).encode()
    require(sha(old_bytes)==m['certificateSha256'],'Original2109 complete certificate bytes differ')
    old=certificate.with_name('getPipeline9WitnessViaCertificate.source2109.ts');observed=certificate.with_name('getPipeline9WitnessViaCertificate.componentDiagnostic.ts')
    require(not old.exists()and not observed.exists(),'Fresh exact-old/observational module copies required');old.write_bytes(old_bytes)
    observed_bytes=tap.instrument(old_bytes.decode()).encode();require(tap.strip(observed_bytes.decode()).encode()==old_bytes,'Observational taps alter untagged old-body bytes');observed.write_bytes(observed_bytes)
    version=subprocess.check_output(['bun','--version'],text=True).strip();require(version==m['bunVersion']=='1.4.2','Bun runtime differs')
    child=subprocess.run(['bun','--tsconfig-override',str(source/'tsconfig.json'),str(ROOT/'relative-v2-main18-component-child.ts'),str(source),str(output),'retained'],cwd=source,capture_output=True,text=True,timeout=300)
    (output/'child.stdout').write_text(child.stdout);(output/'child.stderr').write_text(child.stderr)
    require(child.returncode==0 and (output/'component-diagnostic.json').exists(),'Component child failed; complete stdout/stderr retained without credit')
    diagnostic=json.loads((output/'component-diagnostic.json').read_bytes())
    require(diagnostic['stageSolveCalls']==diagnostic['routingExecutions']==0 and diagnostic['inputBytesUnchanged']is True,'Component diagnostic changed execution/input scope')
    require(diagnostic['baseline']['fullCertificateSha256']==m['baselineCertificateSha256']and diagnostic['baseline']['completeOriginalInstrumentedReturnEqual']is True,'Actual old-body baseline not reproduced')
    require(0<len(diagnostic['candidates'])<=16 and len(diagnostic['candidates'])+1<=20,'Component portfolio exceeds predeclared domain')
    replay=subprocess.run(['python3',str(ROOT/'replay-relative-v2-main18-component-proof.py'),'--output',str(output)],capture_output=True,text=True,timeout=180)
    (output/'replay.stdout').write_text(replay.stdout);(output/'replay.stderr').write_text(replay.stderr)
    require(replay.returncode==0,'Component independent replay process failed; evidence retained without credit')
    replays=json.loads((output/'component-independent-replays.json').read_bytes());require(len(replays)==len(diagnostic['candidates']),'Candidate replay population differs')
    require(certificate.read_bytes()==production_bytes and old.read_bytes()==old_bytes and tap.strip(observed.read_text()).encode()==old_bytes and not git('diff','--name-only')and not git('diff','--cached','--name-only'),'Tracked production source or observational binding changed')
    provenance.update(status='PASS_RETAINED_COMPONENT_DIAGNOSTIC_ONLY',sourceSha=m['sourceSha'],sourceTree=m['sourceTree'],sourceFileHashes=m['sourceFileHashes'],sourceReceiptPins=m['sourceReceiptPins'],inputSourceRun=m['inputSourceRun'],manifestSha256=sha(MANIFEST.read_bytes()),original2109CertificateSha256=sha(old_bytes),observedCertificateSha256=sha(observed_bytes),observationsStripByteExactlyToOld2109=True,productionTrackedSourceUnchanged=True,bunVersion=version,runId=os.environ.get('GITHUB_RUN_ID'),controllerSha=os.environ.get('GITHUB_SHA'),diagnosticSha256=sha((output/'component-diagnostic.json').read_bytes()),independentReplaysSha256=sha((output/'component-independent-replays.json').read_bytes()),stageSolveCalls=0,routingExecutions=0,accepted=False,qualityOrSpeedCredit=False,fullBoardRecovery=False)
    (output/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    payload=json.dumps({'provenance':provenance,'diagnostic':diagnostic,'independentReplays':replays},separators=(',',':')).encode();compressed=gzip.compress(payload,mtime=0);encoded=base64.b64encode(compressed).decode()
    print('RELATIVE_V2_MAIN18_COMPONENT_BEGIN '+json.dumps({'payloadSha256':sha(payload),'gzipSha256':sha(compressed),'payloadBytes':len(payload),'base64Chars':len(encoded),'chunks':(len(encoded)+8191)//8192,'componentDiagnosticOnly':True,'stageSolveCalls':0}),flush=True)
    for index in range(0,len(encoded),8192):print('RELATIVE_V2_MAIN18_COMPONENT_CHUNK '+json.dumps({'seq':index//8192,'data':encoded[index:index+8192]}),flush=True)
    print('RELATIVE_V2_MAIN18_COMPONENT_END '+json.dumps({'payloadSha256':sha(payload),'candidates':len(replays),'independentComponentLeads':sum(value['componentLeadWithIndependentProof']for value in replays),'stageSolveCalls':0,'accepted':False,'qualityOrSpeedCredit':False,'fullBoardRecovery':False}),flush=True)
    require(all(value.get('receipt',{}).get('status')!='REJECTED_INDEPENDENT_RELATIVE_PROOF'for value in replays),'Independent exact proof rejected a source PASS; full diagnostic retained without promotion')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['plan','run'],required=True);parser.add_argument('--source',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args();m=validate()
    if args.mode=='plan':print(json.dumps({'status':'SEALED_RETAINED_COMPONENT_DIAGNOSTIC_ONLY','sourceSha':m['sourceSha'],'stageSolveCalls':0,'routingExecutions':0,'accepted':False,'qualityOrSpeedCredit':False}))
    else:run(args,m)
