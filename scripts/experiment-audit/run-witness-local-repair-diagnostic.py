#!/usr/bin/env python3
"""Blacksmith retained-input component proposals; never acceptance or routing."""
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
MANIFEST=ROOT/'witness-local-repair-diagnostic-20261029.json'
WORKFLOW=ROOT.parent.parent/'.github/workflows/witness-local-repair-diagnostic-20261029.yml'
ASSETS=['run-witness-local-repair-diagnostic.py','witness-local-repair-child.ts','witness-local-repair-proposals.ts','seal-witness-local-repair-diagnostic.py','tests/witness-local-repair-proposals.test.ts','tests/witness-local-repair-diagnostic-integrity.py','run-witness-contact-diagnostic.py','witness-contact-diagnostic-20261029.json','witness-contact-raw-identity.json','run-bottleneck-experiments.py','install-pinned-dependencies.py','witness-quality6-artifact-carrier.py']

def require(value,message):
    if not value: raise ValueError(message)

def sha(raw): return hashlib.sha256(raw).hexdigest()

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

base=load('frozen_local_component_input_loader',ROOT/'run-witness-contact-diagnostic.py')

def validate(value=None):
    m=json.loads(MANIFEST.read_text()) if value is None else value
    original=base.validate()
    require(m['campaign']=='witness-local-repair-diagnostic-20261029' and m['controllerBranch']=='codex/witness-local-repair-diagnostic-20261029','Wrong diagnostic branch or campaign')
    for key in ['sourceSha','sourceTree','certificateRelative','certificateSha256','inputArtifact','inputMembers','inputIdentitySha256','expectedCertificateSummary','runner','bunVersion']:
        require(m[key]==original[key],'Frozen source/input/runtime pin differs: '+key)
    require(m['maximumCandidates']==16 and type(m['maximumCandidates']) is int and m['viaMaximumMove']==0.25 and m['wireMaximumMove']==0.02,'Diagnostic proposal domain changed')
    require(m['expectedBaselineCertificateSha256']=='0b5243f76bc3a3e0aa84001d6657d13d99d5d624e14de1436652aaef923ea2ad','Actual full baseline certificate pin changed')
    require(m['newDiagnosticSubsetNotProductionMovementCap'] is True and all(m[key] is False for key in ['routingAllowed','localDatasetCheckerAllowed','qualityOrSpeedCredit','productionAcceptanceAllowed','fullBoardRecoveryClaim']),'Component diagnostic scope changed')
    require(m['inheritedControllerLocal']=='4953355631574d18b841ec24b90c823ac041ed38' and m['inheritedControllerTree']=='b48811a6ba435b37904e20e0ab65efbcda45cba5' and m['expectedRemoteParent']=='01536bdf4ba44908327f5307504603838c9e0523','Inherited controller differs')
    require(m.get('assetHashes')=={name:sha((ROOT/name).read_bytes()) for name in ASSETS} and m.get('workflowSha256')==sha(WORKFLOW.read_bytes()),'Sealed diagnostic bytes changed')
    return m

def run(args,m):
    require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_EVENT_NAME')=='push' and os.environ.get('GITHUB_REF_NAME')==m['controllerBranch'] and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Retained dataset checking is first-push Blacksmith-only')
    source=args.source.resolve();output=args.output.resolve();require(not output.exists(),'Fresh diagnostic output required');output.mkdir(parents=True)
    git=lambda *v:subprocess.check_output(['git','-C',str(source),*v],text=True).strip()
    require(git('rev-parse','HEAD')==m['sourceSha'] and git('rev-parse','HEAD^{tree}')==m['sourceTree'] and not git('diff','--name-only') and not git('diff','--cached','--name-only'),'Qualified source tree differs')
    common=load('local_component_native_dependencies',ROOT/'run-bottleneck-experiments.py');authority=common.validate_manifest(ROOT/'bottleneck-experiments-20261029.json');common.verify_dependencies(authority,{'A':source,'B':source})
    carrier=load('local_component_input_transport',ROOT/'witness-quality6-artifact-carrier.py');proof=base.download(base.validate(),output,carrier.GitHubClient(os.environ.get('GITHUB_TOKEN')))
    original=source/m['certificateRelative'];before=original.read_bytes();require(sha(before)==m['certificateSha256'],'Unchanged certificate source differs')
    detailed=base.instrument(before.decode());require(base.strip(detailed).encode()==before,'Inherited baseline instrumentation changes source')
    target=original.with_name('getPipeline9WitnessViaCertificate.diagnostic.ts');require(not target.exists(),'Fresh baseline diagnostic copy required');target.write_text(detailed)
    version=subprocess.check_output(['bun','--version'],text=True).strip();require(version==m['bunVersion'],'Bun differs')
    child=subprocess.run(['bun','--tsconfig-override',str(source/'tsconfig.json'),str(ROOT/'witness-local-repair-child.ts'),str(source),str(output),'retained'],cwd=source,capture_output=True,text=True,timeout=300)
    (output/'child.stdout').write_text(child.stdout);(output/'child.stderr').write_text(child.stderr);require(child.returncode==0,'Component child failed; exact stdout/stderr retained')
    result=json.loads((output/'local-repair-diagnostic.json').read_text())
    require(result['baseline']['summary']==m['expectedCertificateSummary'] and result['originalInstrumentedBaselineReturnEqual'] is True,'Baseline certificate reproduction differs')
    require(result['baseline']['fullCertificateSha256']==m['expectedBaselineCertificateSha256'],'Complete baseline certificate differs from the qualified contact diagnostic')
    require(0<len(result['candidates'])<=m['maximumCandidates'] and all(value['accepted'] is False and value['fullBoardRecovery'] is False and value['qualityOrSpeedCredit'] is False and value['rawMaskPassed'] is True and value['canonicalProtectedMaskPassed'] is True for value in result['candidates']),'Candidate mask/scope changed')
    require(result['fullBoardRecovery'] is False and result['qualityOrSpeedCredit'] is False and result['routingExecutions']==0 and result['stageSolveCalls']==0 and result['inputBytesUnchanged'] is True,'No solve or recovery claim allowed')
    require(original.read_bytes()==before and not git('diff','--name-only') and not git('diff','--cached','--name-only'),'Production source changed')
    proof.update(status='PASS_RETAINED_COMPONENT_DIAGNOSTIC_ONLY',sourceSha=m['sourceSha'],sourceTree=m['sourceTree'],manifestSha256=sha(MANIFEST.read_bytes()),certificateSha256=sha(before),originalInstrumentedBaselineReturnEqual=True,productionTrackedSourceUnchanged=True,bunVersion=version,runId=os.environ.get('GITHUB_RUN_ID'),controllerSha=os.environ.get('GITHUB_SHA'),diagnosticSha256=sha((output/'local-repair-diagnostic.json').read_bytes()),qualityOrSpeedCredit=False,routingExecutions=0,stageSolveCalls=0,fullBoardRecovery=False)
    (output/'provenance.json').write_text(json.dumps(proof,indent=2)+'\n')
    payload=json.dumps({'provenance':proof,'diagnostic':result},separators=(',',':')).encode();compressed=gzip.compress(payload,mtime=0);encoded=base64.b64encode(compressed).decode()
    print('WITNESS_LOCAL_REPAIR_DIAGNOSTIC_BEGIN '+json.dumps({'payloadSha256':sha(payload),'gzipSha256':sha(compressed),'payloadBytes':len(payload),'base64Chars':len(encoded),'chunks':(len(encoded)+8191)//8192,'diagnosticOnly':True}),flush=True)
    for index in range(0,len(encoded),8192):print('WITNESS_LOCAL_REPAIR_DIAGNOSTIC_CHUNK '+json.dumps({'seq':index//8192,'data':encoded[index:index+8192]}),flush=True)
    print('WITNESS_LOCAL_REPAIR_DIAGNOSTIC_END '+json.dumps({'payloadSha256':sha(payload),'candidates':len(result['candidates']),'localComponentLeads':sum(value['localComponentLead'] for value in result['candidates']),'qualityOrSpeedCredit':False,'fullBoardRecovery':False}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['plan','run'],required=True);parser.add_argument('--source',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args();manifest=validate()
    if args.mode=='plan':print(json.dumps({'status':'SEALED_COMPONENT_DIAGNOSTIC_ONLY','sourceSha':manifest['sourceSha'],'maximumCandidates':manifest['maximumCandidates'],'routingExecutions':0,'qualityOrSpeedCredit':False}))
    else:run(args,manifest)
