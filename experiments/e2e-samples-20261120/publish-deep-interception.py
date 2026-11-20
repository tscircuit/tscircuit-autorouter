from pathlib import Path
import gzip,json,shutil

root=Path('experiments/e2e-samples-20261120/interception-results');root.mkdir(exist_ok=True)
rows=[]
for folder in sorted(Path('captures').glob('*/*')):
    if not (folder/'report.json').exists():continue
    sample=folder.name;target=root/sample;target.mkdir(exist_ok=True)
    report=json.loads((folder/'report.json').read_text())
    diagnosis_path=Path('diagnoses')/('full-circuit-diagnosis-'+sample)/'analysis.json'
    diagnosis=json.loads(diagnosis_path.read_text())
    for name in ['report.json','process.json','assessment.json','diagnostics.json','pcb.svg','fanout-rejection-examples.json.gz']:
        if (folder/name).exists():shutil.copyfile(folder/name,target/name)
    (target/'pipeline-internals.json.gz').write_bytes(gzip.compress((folder/'pipeline-internals.json').read_bytes(),mtime=0))
    (target/'analysis.json.gz').write_bytes(gzip.compress(diagnosis_path.read_bytes(),mtime=0))
    for image in diagnosis_path.parent.glob('*.svg'):shutil.copyfile(image,target/image.name)
    partials=list(target.glob('fanout-*-partial.svg'))
    if partials:shutil.copyfile(partials[0],target/'partial-fanout.svg')
    fanout=diagnosis['fanout'][0] if diagnosis['fanout'] else None
    process=json.loads((folder/'process.json').read_text())
    assessment=json.loads((folder/'assessment.json').read_text()) if (folder/'assessment.json').exists() else None
    row={'sample':sample,'report':report,'process':process,'assessment':assessment,'winding':diagnosis['winding'],'fanout':fanout,'identitySnapshotName':diagnosis['identitySnapshotName']}
    extended=Path('extended')/sample
    if extended.exists():
        extra=target/'extended';extra.mkdir(exist_ok=True)
        for name in ['report.json','process.json','assessment.json','diagnostics.json','pcb.svg']:
            if (extended/name).exists():shutil.copyfile(extended/name,extra/name)
        row['extended']={key:json.loads((extended/(key+'.json')).read_text()) if (extended/(key+'.json')).exists() else None for key in ['report','process','assessment','diagnostics']}
        if (extended/'pcb.svg').exists():shutil.copyfile(extended/'pcb.svg',target/'pcb.svg')
    rows.append(row)
assert len(rows)==10
(root/'summary.json.gz').write_bytes(gzip.compress(json.dumps(rows).encode(),mtime=0))
small=[]
for row in rows:
    f=row['fanout']
    small.append({'sample':row['sample'],'status':row['report']['status'],'processTimedOut':row['process']['timedOut'],'requestedNets':row['assessment']['requestedNets'] if row['assessment'] else None,'connectedByExistingCopper':row['assessment']['connectedNets'] if row['assessment'] else None,'fanout':None if not f else {'bestEscapes':f['bestEscapes'],'requested':f['requested'],'busCount':f['preparedBusCount'],'noLayerBuses':sum(bus['individuallyRoutableLayers']==[] for bus in f['preflight']['buses']),'completedAssignments':len(json.loads(gzip.decompress((root/row['sample']/'pipeline-internals.json.gz').read_bytes()))['completedAssignments']),'mergeExperiment':f.get('mergeExperiment')},'windingCalls':len(row['winding']),'windingFailures':[w['error'] for w in row['winding'] if w['failed']],'extended':None if 'extended' not in row else {key:row['extended'][key] for key in ['process','diagnostics']}})
(root/'statistics.json').write_text(json.dumps(small,indent=2)+'\n')
print('E2E_DEEP_STATISTICS',json.dumps(small))
