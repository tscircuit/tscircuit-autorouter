#!/usr/bin/env python3
"""Pure tiny instrumentation, source equality and transport controls; no dataset checking."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('contact_diagnostic_test',ROOT/'run-witness-contact-diagnostic.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)

def main():
    source=Path(os.environ.get('WITNESS_DIAGNOSTIC_SYNTHETIC_SOURCE','/tmp/autorouter-witness-via-repair-v2'))
    manifest=json.loads(r.MANIFEST.read_text());relative=manifest['certificateRelative'];raw=(source/relative).read_bytes();assert r.sha(raw)==manifest['certificateSha256']
    instrumented=r.instrument(raw.decode());assert r.strip(instrumented).encode()==raw
    checks=['tagged-insertions-strip-to-exact-qualified-source','original-source-hash-bound']
    try:r.instrument(raw.decode().replace('type RawPoint = ','type RenamedRawPoint = '))
    except ValueError:checks.append('changed-insertion-site-rejected')
    else:raise AssertionError('changed source insertion site accepted')
    with tempfile.TemporaryDirectory(prefix='witness-contact-pure-') as temporary:
        temp=Path(temporary);tiny=temp/'source';tiny.mkdir();shutil.copytree(source/'lib',tiny/'lib');shutil.copyfile(source/'tsconfig.json',tiny/'tsconfig.json');shutil.copyfile(source/'package.json',tiny/'package.json')
        fixture=tiny/'tests/features';fixture.mkdir(parents=True);shutil.copyfile(source/'tests/features/witnessViaPadRepairFixture.ts',fixture/'witnessViaPadRepairFixture.ts');(tiny/'node_modules').symlink_to('/tmp/autorouter-post588-dependencies/node_modules',target_is_directory=True)
        target=tiny/relative;target.with_name('getPipeline9WitnessViaCertificate.diagnostic.ts').write_text(instrumented)
        out=temp/'output';out.mkdir();child=subprocess.run(['/tmp/autorouter-post588-bun/package/bin/bun','--tsconfig-override',str(tiny/'tsconfig.json'),str(ROOT/'witness-contact-diagnostic-child.ts'),str(tiny),str(out),'synthetic'],cwd=tiny,text=True,capture_output=True)
        assert child.returncode==0,child.stderr;result=json.loads((out/'diagnostic.json').read_text());assert result['completeCertificateReturnEqual'] and result['inputBytesUnchanged'] and result['summary']['status']=='PASS' and result['summary']['demandsChecked']==2 and result['routingExecutions']==0 and result['qualityOrSpeedCredit'] is False
        assert len(result['graph'])==2 and all(x['commonRoots'] for x in result['graph']);assert {x['kind'] for x in result['exactOriginalViolationArrays']}=={'getFixedObstacleViolations','getNewViaPadViolations'}
        assert target.read_bytes()==raw;checks+=['synthetic-original-instrumented-complete-return-equality','synthetic-demand-root-details-complete','both-original-violation-arrays-tapped-without-duplicate-call','source-and-input-unchanged','no-local-dataset-checker-or-routing']
        carrier=r.load('contact_transport_fixture_carrier',ROOT/'witness-quality6-artifact-carrier.py');payload=io.BytesIO()
        contents={'original-input.json':b'{"synthetic":true}','point-pair-context.json':b'{"tiny":1}','raw-new-traces.json':b'[]'}
        with zipfile.ZipFile(payload,'w') as z:
            for name,data in contents.items():z.writestr('tiny/'+name,data)
        archive=payload.getvalue();m=copy.deepcopy(manifest);m['inputArtifact']['size_in_bytes']=len(archive);m['inputArtifact']['digest']='sha256:'+r.sha(archive);m['inputMembers']={name:{'member':'tiny/'+name,'bytes':len(data),'sha256':r.sha(data)} for name,data in contents.items()}
        artifact=copy.deepcopy(m['inputArtifact']);artifact['expired']=False;lineage=artifact['workflow_run'];run={'id':lineage['id'],'head_sha':lineage['head_sha'],'path':carrier.WORKFLOW,'run_attempt':1,'repository':{'id':924883209,'full_name':carrier.REPOSITORY}}
        class Client:
            def api_get(self,path):return run if '/actions/runs/' in path else artifact
            def download(self,artifact_id,size):assert artifact_id==artifact['id'] and size==len(archive);return archive
        extracted=temp/'tiny-extracted';extracted.mkdir();proof=r.download(m,extracted,Client());assert proof['originalZipSha256']==r.sha(archive) and all((extracted/name).read_bytes()==data for name,data in contents.items());checks.append('synthetic-original-ZIP-and-member-byte-binding')
        for field in ['digest','name','size_in_bytes']:
            bad=copy.deepcopy(m);bad['inputArtifact'][field]=('sha256:'+'0'*64 if field=='digest' else 'wrong' if field=='name' else len(archive)+1);badout=temp/field;badout.mkdir()
            try:r.download(bad,badout,Client())
            except ValueError:checks.append('reject-foreign-artifact-'+field)
            else:raise AssertionError('forged artifact accepted')
        bad=copy.deepcopy(m);bad['inputMembers']['raw-new-traces.json']['sha256']='0'*64;badout=temp/'member';badout.mkdir()
        try:r.download(bad,badout,Client())
        except ValueError:checks.append('reject-foreign-member-bytes')
        else:raise AssertionError('forged member accepted')
    print(json.dumps({'status':'PASS_PURE_DIAGNOSTIC_INSTRUMENTATION_TRANSPORT_CONTROLS','checks':checks,'count':len(checks),'actualDatasetCheckerExecutions':0,'routingExecutions':0,'networkRequests':0}))

if __name__=='__main__':main()
