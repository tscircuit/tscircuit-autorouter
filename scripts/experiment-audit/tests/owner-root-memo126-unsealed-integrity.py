"""One synthetic publication-gate control: no routing, checker or network."""
import copy, hashlib, importlib.util, json, sys, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent

def load(name, filename):
    spec=importlib.util.spec_from_file_location(name,ROOT/filename)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

r=load('memo126_gate_runtime','run-owner-root-memo126.py')
c=load('memo126_gate_carrier','owner-root-memo126-artifact-carrier.py')
q=load('memo126_gate_raw','owner-root-memo126-raw-proof.py')

def main():
    checks=[];calls=[]
    def reject(label, action):
        try:action()
        except (ValueError,AssertionError) as error:
            assert 'UNSEALED' in str(error) or 'publication' in str(error), (label,str(error))
            checks.append(label);return
        raise AssertionError('Accepted unsealed publication: '+label)
    def forbidden_api(*args):
        calls.append(args);raise AssertionError('Source gate contacted network')
    manifest=json.loads(r.MANIFEST.read_text())
    assert r.P_SOURCE=='50a8051cd9853d260b26d312246714cddbb67749'
    assert r.P_TREE=='aed1e4ca2eef423389ef4adedc039667b617d4af'
    assert all(manifest['roles'][role]['feedbackVersion']==2 and len(manifest['roles'][role]['secondaryCoverageContract']['fields'])==15 and manifest['roles'][role]['secondaryCoverageContract']['referencePredicateCount']==2 for role in ['P','F'])
    checks.append('P-and-F-both-explicit-fifteen-field-v2-admission7-reference2')
    # Test through a genuine bound inherited authority before weakening only the local drafting source.
    original_source=r.SOURCE;original_carrier_source=c.SOURCE_PIN
    r.SOURCE='UNSEALED';q.runtime.SOURCE='UNSEALED';c.SOURCE_PIN='UNSEALED'
    try:
        reject('unsealed-runtime-validation',r.validate)
        previous=list(sys.argv)
        try:
            for mode in ['plan','select','verify-checkouts','verify-dependencies','run','parse','union']:
                sys.argv=['run-owner-root-memo126.py','--mode',mode]
                reject('unsealed-cli-'+mode,r.main)
        finally:sys.argv=previous
        reject('unsealed-direct-carrier-publication',c.validate_source_publication)
        reject('unsealed-carrier-plan-before-network',lambda:c.plan(manifest,run_id='901',controller_sha='c'*40,repository=c.REPOSITORY,manifest_sha256='d'*64,api_get=forbidden_api))
        reject('unsealed-raw-qualification-before-files',lambda:q.qualify('srj18',0,None,None,None,None,None,None,None,1,'901','c'*40))
        assert not calls
        checks.append('all-unsealed-gates-no-source-run-checker-or-network-execution')
        # A plausible hex source without a real publication digest is insufficient.
        c.SOURCE_PIN='f'*40
        reject('hex-source-alone-cannot-seal-carrier',c.validate_source_publication)
        # Even a matching digest of the actual unsealed JSON cannot manufacture source provenance.
        original_hash=c.PUBLICATION_SHA256
        try:
            c.PUBLICATION_SHA256=hashlib.sha256(c.PUBLICATION_FILE.read_bytes()).hexdigest()
            reject('matching-unsealed-json-hash-cannot-seal-carrier',c.validate_source_publication)
        finally:c.PUBLICATION_SHA256=original_hash
    finally:
        r.SOURCE=original_source;q.runtime.SOURCE=original_source;c.SOURCE_PIN=original_carrier_source
    # These fixture-only identities never get written into the actual manifest/publication.
    assert json.loads(r.MANIFEST.read_text())==manifest
    checks.append('synthetic-pin-tests-do-not-mutate-real-manifest-or-publication')
    print(json.dumps({'status':'PASS_UNSEALED_MEMO_SOURCE_FAILS_CLOSED_BEFORE_ACTUAL_EXECUTION','count':len(checks),'checks':checks,'networkRequests':len(calls),'actualBoards':0,'checkerExecutions':0}))

if __name__=='__main__':main()
