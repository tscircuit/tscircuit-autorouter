import copy,gzip,hashlib,json,shutil,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1]);operation=sys.argv[2];board=sys.argv[3];cohort=sys.argv[4]
controller=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
plan=json.loads((controller/'port-cost-plan.json').read_text())
proof=json.loads((controller/'port-cost/mapping-proof.json').read_text())
assert subprocess.check_output(['git','-C',str(root/'source-tiny'),'rev-parse','HEAD'],text=True).strip()==plan['sourceCommit']
assert proof['passed'] and proof['unchangedOutsideClassAndNewHelper']
for item in proof['sourceFiles']:
 assert sha((root/'source-tiny'/item['path']).read_bytes())==item['afterSha256']
manifest=json.loads((root/'runtime-manifest.json').read_text())
case=json.loads((root/'cases'/f'{board}-{cohort}.json').read_text())
assert case['captureDeadlineMs']==900000 and case['hardDeadlineMs']==960000
assert case['fanout'] is False and case['planes']==(cohort=='original')
assert case['mode']=='phased'
assert {p['name']:p['version'] for p in manifest['packages']}=={'tscircuit':'0.0.3244','@tscircuit/core':'0.0.2426','@tscircuit/eval':'0.0.1819','@tscircuit/capacity-autorouter':'0.0.1133'}
for p in manifest['packages']:
 assert sha(Path(p['entry']).read_bytes())==p['entrySha256']

def save(path,contents):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(contents,indent=2)+'\n')

if operation=='baseline':
 assert manifest['sourceOverrides'] is False and manifest['dependencyOverrides']==[]
 save(root/'base-manifest.json',manifest)
 case['runtimeManifestPath']=str(root/'base-manifest.json')
 save(root/'lanes/base'/f'{board}-{cohort}.json',case)
elif operation=='candidate':
 base=json.loads((root/'base-manifest.json').read_text());assert manifest==base
 ar=next(p for p in manifest['packages'] if p['name']=='@tscircuit/capacity-autorouter')
 assert ar['entrySha256']==proof['publishedEntrySha256']
 original=Path(ar['entry']).parent.parent;overlay=root/'npm/autorouter-port-cost'
 shutil.copytree(original,overlay,symlinks=True)
 entry=overlay/ar['entryRelative'];compiled=gzip.decompress((controller/'port-cost/candidate.js.gz').read_bytes());assert sha(compiled)==proof['candidateEntrySha256'];entry.write_bytes(compiled)
 for published in ar['publishedFiles']:
  if published['path']!=ar['entryRelative']:assert sha((overlay/published['path']).read_bytes())==published['sha256']
 descriptor={'kind':'qualified-source-overlay','package':'tiny-hypergraph','baseCommit':proof['baseCommit'],'sourceCommit':plan['sourceCommit'],'sourceFiles':proof['sourceFiles'],'publishedAutorouterSha256':proof['publishedEntrySha256'],'candidateAutorouterSha256':proof['candidateEntrySha256'],'mappingSha256':sha((controller/'port-cost/mapping-proof.json').read_bytes())}
 alias=root/'runtime/node_modules/@tscircuit/capacity-autorouter';assert alias.resolve()==original.resolve();alias.unlink();alias.symlink_to(overlay)
 ar['publishedEntrySha256']=ar['entrySha256'];ar['entrySha256']=sha(compiled);ar['entry']=str(entry)
 manifest.update(sourceOverrides=True,experiment='port-cost-fix',routingSourceOverride=descriptor,dependencyOverrides=[descriptor])
 save(root/'candidate-manifest.json',manifest)
 case.update(runtimeManifestPath=str(root/'candidate-manifest.json'),experiment='port-cost-fix',routingSourceOverride=descriptor,dependencyOverrides=[descriptor])
 save(root/'lanes/candidate'/f'{board}-{cohort}.json',case)
 save(root/'port-cost-runtime-proof.json',{'sourceCommit':plan['sourceCommit'],'mapping':proof,'baseManifestSha256':sha((root/'base-manifest.json').read_bytes()),'candidateManifestSha256':sha((root/'candidate-manifest.json').read_bytes()),'onlyPackageAliasChanged':str(alias),'nativeCaseSourceSha256':case['sourceSha256'],'deadlinesUnchanged':True,'routingWasmAllowed':False})
else:raise ValueError(operation)
print(json.dumps({'operation':operation,'board':board,'cohort':cohort,'sourceCommit':plan['sourceCommit']}))
