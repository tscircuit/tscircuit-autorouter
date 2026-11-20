from pathlib import Path
import hashlib,json,os,subprocess,sys

sample=sys.argv[1]
workspace=Path(os.environ['GITHUB_WORKSPACE'])
experiment=workspace/'experiments/e2e-samples-20261120'
manifest=json.loads((experiment/'preserve-candidate.json').read_text())
module=workspace/'core'
candidate=workspace/'core-candidate'
original={entry['path']:(module/entry['path']).read_bytes() for entry in manifest['files']}
for entry in manifest['files']:
    assert hashlib.sha256(original[entry['path']]).hexdigest()==entry['beforeSha256'],entry['path']
    assert hashlib.sha256((candidate/entry['path']).read_bytes()).hexdigest()==entry['afterSha256'],entry['path']
revisions=json.loads(Path('revisions.json').read_text())
order=['before','after'] if sample.endswith('-original') else ['after','before']
for variant in order:
    for entry in manifest['files']:
        content=original[entry['path']] if variant=='before' else (candidate/entry['path']).read_bytes()
        (module/entry['path']).write_bytes(content)
    revision={**revisions,'variant':variant,'pairOrder':order,'core':manifest['base'] if variant=='before' else manifest['candidate'],'coreSourceFiles':[{**entry,'actualSha256':hashlib.sha256((module/entry['path']).read_bytes()).hexdigest()} for entry in manifest['files']]}
    Path('revisions.json').write_text(json.dumps(revision,indent=2)+'\n')
    output=workspace/'results'/variant/sample
    subprocess.run(['python3','run.py',sample,str(output)],check=True)
    assert (output/'report.json').exists(),(sample,variant,'No routing report')
    report=json.loads((output/'report.json').read_text())
    assert report['revisions']['variant']==variant
    if report['initialCopper'] is None:
        assert not report['phases'] and report['counts'].get('pcb_trace',0)==0 and report['counts'].get('pcb_via',0)==0,(sample,variant,'No initial capture without a routing stop')
    else:assert report['initialCopper']==0,(sample,variant,'Input contained routed copper')
    assert not any('serialize cyclic' in message for message in report['errors'])
    if (output/'circuit.json.gz').exists():
        subprocess.run(['bun','assess.ts',sample,str(output)],check=True,timeout=180)
print('E2E_PAIR_ORDER',json.dumps({'sample':sample,'order':order}))
