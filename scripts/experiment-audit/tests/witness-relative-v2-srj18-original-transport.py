"""One pure synthetic test of exact MST lineage and byte transport."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('main_mst_original_transport_controls',ROOT/'download-witness-relative-v2-srj18-original.py');transport=importlib.util.module_from_spec(spec);spec.loader.exec_module(transport)


class OriginalTransportControls(unittest.TestCase):
    def test_exact_main_mst_transport_and_forgery_rejection(self):
        manifest=json.loads((ROOT/'witness-relative-v2-srj18-trial-hotfix-20261030.json').read_bytes())
        expected=transport.EXPECTED_RUN
        run={k:v for k,v in expected.items()if k not in ['tree','repository_id']}
        run.update(head_commit={'tree_id':expected['tree']},repository={'id':expected['repository_id'],'full_name':transport.REPOSITORY},event='push',status='completed',conclusion='success')
        metadata={**manifest['inputArtifact'],'expired':False}
        transport.verify_run(manifest,run);transport.verify_artifact(manifest,metadata)
        checks=['main-MST-lineage-and-artifact-positive']
        for key,value in [('id',1),('head_sha','0'*40),('head_branch','other'),('path','.github/workflows/witness-quality6-20261029.yml'),('run_attempt',2),('event','pull_request'),('status','in_progress'),('conclusion','failure')]:
            bad=copy.deepcopy(run);bad[key]=value
            with self.assertRaises(ValueError):transport.verify_run(manifest,bad)
            checks.append('reject-run-'+key)
        for field in ['tree_id']:
            bad=copy.deepcopy(run);bad['head_commit'][field]='0'*40
            with self.assertRaises(ValueError):transport.verify_run(manifest,bad)
        for key,value in [('full_name','other/repository'),('id',1)]:
            bad=copy.deepcopy(run);bad['repository'][key]=value
            with self.assertRaises(ValueError):transport.verify_run(manifest,bad)
            checks.append('reject-run-repository-'+key)
        for key,value in [('id',1),('name','witness-quality6-raw-witness-via-pad-sample-008-srj24-AB'),('size_in_bytes',1),('digest','sha256:'+'0'*64),('expired',True)]:
            bad=copy.deepcopy(metadata);bad[key]=value
            with self.assertRaises(ValueError):transport.verify_artifact(manifest,bad)
            checks.append('reject-artifact-'+key)
        for key,value in [('id',1),('head_sha','0'*40),('head_branch','other'),('repository_id',1),('head_repository_id',1)]:
            bad=copy.deepcopy(metadata);bad['workflow_run'][key]=value
            with self.assertRaises(ValueError):transport.verify_artifact(manifest,bad)
            checks.append('reject-artifact-lineage-'+key)
        stream=io.BytesIO();members={}
        with zipfile.ZipFile(stream,'w')as archive:
            for name,pin in manifest['inputMembers'].items():
                data=json.dumps({'synthetic':name}).encode();archive.writestr(pin['member'],data)
                members[name]={'member':pin['member'],'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        raw=stream.getvalue();synthetic=copy.deepcopy(manifest);synthetic['inputMembers']=members;synthetic['inputArtifact'].update(size_in_bytes=len(raw),digest='sha256:'+hashlib.sha256(raw).hexdigest())
        class FakeClient:
            def __init__(self):self.requests=[]
            def api_get(self,path):
                self.requests.append(path)
                if path.endswith('/actions/runs/'+str(expected['id'])):return copy.deepcopy(run)
                if path.endswith('/actions/artifacts/'+str(synthetic['inputArtifact']['id'])):return {**copy.deepcopy(synthetic['inputArtifact']),'expired':False}
                raise AssertionError('Unexpected synthetic API path')
            def download(self,artifact_id,size):
                self.asserted=(artifact_id,size)
                return raw
        with tempfile.TemporaryDirectory()as directory:
            output=Path(directory);client=FakeClient();proof=transport.download(synthetic,output,client)
            self.assertEqual(client.asserted,(synthetic['inputArtifact']['id'],len(raw)))
            self.assertEqual(len(client.requests),2)
            self.assertEqual(proof['originalZipSha256'],hashlib.sha256(raw).hexdigest())
            self.assertEqual(proof['exactMembers'],members)
            self.assertEqual((output/'original-input.zip').read_bytes(),raw)
            self.assertEqual(set(p.name for p in output.iterdir()),{'original-input.zip',*members})
            bad=copy.deepcopy(synthetic);bad['inputMembers']['raw-new-traces.json']['sha256']='0'*64
            with self.assertRaises(ValueError):transport.verify_zip(bad,raw,output)
            with self.assertRaises(ValueError):transport.verify_zip(synthetic,raw+b'x',output)
        checks.extend(['fake-client-entire-download-two-API-calls-and-exact-six-members','synthetic-six-members-and-server-ZIP-byte-exact','reject-member-digest','reject-ZIP-byte-or-size-mutation'])
        self.assertNotIn('base.download(', (ROOT/'run-witness-relative-v2-srj18-trial-hotfix.py').read_text())
        print(json.dumps({'status':'PASS_PURE_EXACT_MAIN_MST_TRANSPORT_CONTROLS','checks':checks,'count':len(checks),'actualDatasetReads':0,'networkRequests':0,'actualSourceStageOrCheckerExecutions':0}))


if __name__=='__main__':unittest.main()
