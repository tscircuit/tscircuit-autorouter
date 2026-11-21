from pathlib import Path
import base64,hashlib,json,shutil,tarfile,tempfile
root=Path('experiments/boards-3267/runtime').resolve()
package=root/'node_modules/circuit-json-to-connectivity-map'
assert json.loads((package/'package.json').read_text())['version']=='0.0.33'
previous=hashlib.sha256((package/'dist/index.js').read_bytes()).hexdigest()
archive=Path('experiments/boards-3267/connectivity-map-0.0.36.tgz')
metadata=json.loads(archive.with_suffix('.metadata.json').read_text())
assert 'sha512-'+base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode()==metadata['dist']['integrity']
with tempfile.TemporaryDirectory() as d:
 with tarfile.open(archive) as tar:
  assert all(m.name.startswith('package/') and '..' not in Path(m.name).parts for m in tar.getmembers())
  tar.extractall(d,filter='data')
 # Keep the dependency's existing nested dependencies; both releases require the same math-utils version.
 shutil.copytree(package/'node_modules',Path(d)/'package/node_modules')
 shutil.rmtree(package)
 shutil.copytree(Path(d)/'package',package)
provenance={'dependency':'circuit-json-to-connectivity-map','before':'0.0.33','after':'0.0.36','previousEntrySha256':previous,'nextEntrySha256':hashlib.sha256((package/'dist/index.js').read_bytes()).hexdigest(),'archiveIntegrity':metadata['dist']['integrity'],'change':'Replace only the root dependency with the verified published 0.0.36 package; leave all circuit sources, routing options and remaining installed packages unchanged.'}
Path('connectivity-update-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps(provenance))
