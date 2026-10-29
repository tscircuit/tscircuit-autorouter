#!/usr/bin/env python3
"""One authenticated retained-output certificate diagnostic, never routing."""
import argparse
import base64
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile

ROOT=Path(__file__).resolve().parent
MANIFEST=ROOT/'witness-contact-diagnostic-20261029.json'
WORKFLOW=ROOT.parent.parent/'.github/workflows/witness-contact-diagnostic-20261029.yml'
BEGIN='/* WITNESS_DIAGNOSTIC_BEGIN */'
END='/* WITNESS_DIAGNOSTIC_END */'
ASSETS=['seal-witness-contact-diagnostic.py','bottleneck-experiments-20261029.json','run-witness-contact-diagnostic.py','witness-contact-diagnostic-child.ts','tests/witness-contact-diagnostic-integrity.py','witness-contact-raw-identity.json','witness-quality6-artifact-carrier.py','run-bottleneck-experiments.py','install-pinned-dependencies.py']

def require(value,message):
    if not value: raise ValueError(message)

def sha(raw): return hashlib.sha256(raw).hexdigest()

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def tagged(text): return BEGIN+text+END

def strip(text): return re.sub(re.escape(BEGIN)+r'[\s\S]*?'+re.escape(END),'',text)

def instrument(source):
    additions=[]
    def insert(needle,value):
        nonlocal source
        require(source.count(needle)==1,'Instrumentation insertion site changed: '+needle[:70])
        source=source.replace(needle,tagged(value)+needle);additions.append(needle)
    insert('type RawPoint = ','''export const witnessContactDiagnostics: Record<string, unknown>[] = []
function witnessDiagnosticRoot(parents: Map<string, string>, key: string): string {
  let current = key
  for (let count = 0; count < parents.size; count++) {
    const next = parents.get(current)
    if (next === undefined || next === current) return current
    current = next
  }
  throw new Error("Diagnostic parent inspection found a cycle")
}
function witnessDiagnosticArray<T>(kind: string, values: T[], context: unknown): T[] {
  witnessContactDiagnostics.push({ kind, values, context })
  return values
}
''')
    needle='  for (const [owner, terminals] of ownerTerminals) {\n'
    require(source.count(needle)==1,'Owner loop changed');source=source.replace(needle,needle+tagged('    const diagnosticTerminals: unknown[] = []\n'))
    insert('      common = common === undefined ? contacts : new Set([...common].filter((root) => contacts.has(root)))',
        '      diagnosticTerminals.push({ terminal, layers, contacts: [...contacts], commonBefore: common === undefined ? null : [...common] })\n')
    insert('    if (common === undefined || common.size === 0) reasons.push(',
        '''    witnessContactDiagnostics.push({ kind: "owner-contact-graph", owner, terminals: diagnosticTerminals,
      commonRoots: common === undefined ? null : [...common],
      points: ownerPoints.map((point) => ({ ...point, root: witnessDiagnosticRoot(parents, point.key) })),
      canonicalPads: ownerPads.map((value: OriginalIntentJson) => ({ ownerRecord: value, geometry: circuit[value.canonicalIndex] })) })
''')
    for function,context in [('getFixedObstacleViolations','{ routes, obstacles }'),('getNewViaPadViolations','{ routes, obstacles }')]:
        start='  return '+function+'('
        require(source.count(start)==1,'Violation call changed')
        position=source.index(start)+len('  return ')
        source=source[:position]+tagged('witnessDiagnosticArray("'+function+'", ')+source[position:]
        close=source.index(').length',position)
        source=source[:close+1]+tagged(', '+context+')')+source[close+1:]
    return source

def validate():
    m=json.loads(MANIFEST.read_text())
    require(m['campaign']=='witness-contact-diagnostic-20261029' and m['controllerBranch']=='codex/witness-contact-diagnostic-20261029','Diagnostic scope changed')
    require(m['sourceSha']=='2109f9e96957c06f23aef2b079f6d59fba23ea52' and m['sourceTree']=='83d39c038ba8bdbb01fc53728e5069fd594d2d23','Qualified source changed')
    require(m['routingAllowed'] is False and m['localDatasetCheckerAllowed'] is False and m['qualityOrSpeedCredit'] is False,'Diagnostic-only scope changed')
    require(m['inputIdentitySha256']==sha((ROOT/'witness-contact-raw-identity.json').read_bytes())=='4d67c4d30f85b2d1cc66e34c7eab59560811ef3fa7ef6c87f511cb920338dd6d','Retained input identity receipt changed')
    identity=json.loads((ROOT/'witness-contact-raw-identity.json').read_text())
    require(m['inputArtifact']==identity['artifacts']['V1'] and m['inputMembers']==identity['hashes']['V1']['A'] and m['case']=='srj24:8','Exact retained input artifact/member selection changed')
    require(m['expectedCertificateSummary']=={'status':'UNKNOWN','demandsChecked':167,'reasonCount':51,'referenceErrorCount':0,'srjObstacleViolationCount':2,'viaPadPolicyViolationCount':1,'viaInPadViolationCount':0,'foreignViaPadFindings':1,'ownershipCoverageStatus':'COMPLETE'},'Actual source-count reproduction target changed')
    require(m.get('workflowSha256')==sha(WORKFLOW.read_bytes()) and m.get('assetHashes')=={name:sha((ROOT/name).read_bytes()) for name in ASSETS},'Diagnostic sealed bytes changed')
    return m

def download(m,output,client):
    carrier=load('frozen_original_zip_client',ROOT/'witness-quality6-artifact-carrier.py')
    item=m['inputArtifact'];lineage=item['workflow_run'];run=client.api_get('/repos/'+carrier.REPOSITORY+'/actions/runs/'+str(lineage['id']))
    source=carrier.run_pin(run,run_id=str(lineage['id']),controller_sha=lineage['head_sha'],repository=carrier.REPOSITORY)
    require(source['run_attempt']==1,'Original input run attempt differs')
    metadata=client.api_get('/repos/'+carrier.REPOSITORY+'/actions/artifacts/'+str(item['id']))
    pin=carrier.artifact_pin(metadata,source)
    require(pin['artifact_id']==item['id'] and pin['artifact_name']==item['name'] and pin['whole_bytes']==item['size_in_bytes'] and pin['whole_sha256']==item['digest'][7:],'Authenticated original input artifact metadata differs')
    raw=client.download(item['id'],item['size_in_bytes']);require(sha(raw)==item['digest'][7:],'Input is not exact original API server ZIP')
    archive=output/'original-input.zip';archive.write_bytes(raw)
    with zipfile.ZipFile(archive) as z:
        names=z.namelist();require(len(names)==len(set(names)) and all(not PurePosixPath(n).is_absolute() and '..' not in PurePosixPath(n).parts for n in names),'Unsafe original ZIP')
        for name,proof in m['inputMembers'].items():
            data=z.read(proof['member']);require(len(data)==proof['bytes'] and sha(data)==proof['sha256'],'Original input member differs: '+name)
            (output/name).write_bytes(data)
    return {'artifact':metadata,'sourceRun':run,'originalZipSha256':sha(raw),'exactMembers':m['inputMembers']}

def run(args,m):
    require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_EVENT_NAME')=='push' and os.environ.get('GITHUB_REF_NAME')==m['controllerBranch'] and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Actual retained dataset checking is allowed only on the reviewed first Blacksmith workflow push')
    source=args.source.resolve();output=args.output.resolve();require(not output.exists(),'Fresh diagnostic output required');output.mkdir(parents=True)
    git=lambda *v:subprocess.check_output(['git','-C',str(source),*v],text=True).strip()
    require(git('rev-parse','HEAD')==m['sourceSha'] and git('rev-parse','HEAD^{tree}')==m['sourceTree'] and not git('diff','--name-only') and not git('diff','--cached','--name-only'),'Production source checkout differs')
    common=load('diagnostic_native_dependency_verifier',ROOT/'run-bottleneck-experiments.py');authority=common.validate_manifest(ROOT/'bottleneck-experiments-20261029.json');common.verify_dependencies(authority,{'A':source,'B':source})
    carrier=load('diagnostic_download_client',ROOT/'witness-quality6-artifact-carrier.py');proof=download(m,output,carrier.GitHubClient(os.environ.get('GITHUB_TOKEN')))
    original=source/m['certificateRelative'];before=original.read_bytes();require(sha(before)==m['certificateSha256'],'Qualified certificate source hash differs')
    instrumented=instrument(before.decode());require(strip(instrumented).encode()==before,'Instrumentation is not insertions-only')
    target=original.with_name('getPipeline9WitnessViaCertificate.diagnostic.ts');require(not target.exists(),'Fresh diagnostic copy required');target.write_text(instrumented)
    version=subprocess.check_output(['bun','--version'],text=True).strip();require(version=='1.4.2','Diagnostic Bun runtime differs')
    completed=subprocess.run(['bun','--tsconfig-override',str(source/'tsconfig.json'),str(ROOT/'witness-contact-diagnostic-child.ts'),str(source),str(output),'retained'],cwd=source,capture_output=True,text=True,timeout=180)
    (output/'child.stdout').write_text(completed.stdout);(output/'child.stderr').write_text(completed.stderr);require(completed.returncode==0,'Diagnostic child failed; raw stdout/stderr retained')
    result=json.loads((output/'diagnostic.json').read_text());require(result['summary']==m['expectedCertificateSummary'] and result['completeCertificateReturnEqual'] is True,'Actual retained certificate does not reproduce qualified V2 initial counts/equality')
    require(original.read_bytes()==before and not git('diff','--name-only') and not git('diff','--cached','--name-only'),'Production tracked source mutated')
    proof.update(status='PASS_RETAINED_CERTIFICATE_DIAGNOSTIC',sourceSha=m['sourceSha'],sourceTree=m['sourceTree'],manifestSha256=sha(MANIFEST.read_bytes()),certificateSha256=sha(before),instrumentedSha256=sha(target.read_bytes()),instrumentationStripsToExactQualifiedSource=True,productionTrackedSourceUnchanged=True,bunVersion=version,runId=os.environ.get('GITHUB_RUN_ID'),controllerSha=os.environ.get('GITHUB_SHA'),diagnosticSha256=sha((output/'diagnostic.json').read_bytes()),qualityOrSpeedCredit=False,routingExecutions=0)
    (output/'provenance.json').write_text(json.dumps(proof,indent=2)+'\n')
    payload=json.dumps({'provenance':proof,'diagnostic':result},separators=(',',':')).encode();compressed=gzip.compress(payload,mtime=0);encoded=base64.b64encode(compressed).decode()
    print('WITNESS_CONTACT_DIAGNOSTIC_BEGIN '+json.dumps({'payloadSha256':sha(payload),'gzipSha256':sha(compressed),'payloadBytes':len(payload),'base64Chars':len(encoded),'chunks':(len(encoded)+8191)//8192,'diagnosticOnly':True}),flush=True)
    for i in range(0,len(encoded),8192):print('WITNESS_CONTACT_DIAGNOSTIC_CHUNK '+json.dumps({'seq':i//8192,'data':encoded[i:i+8192]}),flush=True)
    print('WITNESS_CONTACT_DIAGNOSTIC_END '+json.dumps({'payloadSha256':sha(payload),'summary':result['summary'],'qualityOrSpeedCredit':False}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['plan','run'],required=True);parser.add_argument('--source',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args();m=validate()
    if args.mode=='plan':print(json.dumps({'status':'SEALED_DIAGNOSTIC_ONLY_NO_ROUTING','sourceSha':m['sourceSha'],'inputOriginalArtifact':m['inputArtifact']['id']}))
    else:run(args,m)
