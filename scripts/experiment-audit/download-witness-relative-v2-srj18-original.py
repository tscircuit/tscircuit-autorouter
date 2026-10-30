"""Exact MAIN MST18 artifact transport; no routing, stage or checker code."""
import hashlib
from pathlib import PurePosixPath
import zipfile

REPOSITORY='tscircuit/tscircuit-autorouter'
EXPECTED_RUN={'id':40974963334,'head_sha':'fd28c1325f48efaba0f4189e432777be7dd51d6d','head_branch':'codex/layer-aware-mst-controller-20261029','path':'.github/workflows/layer-aware-mst84-20261029.yml','tree':'03f9bde76aba4147502b63ac5d87a0df85162b1f','run_attempt':1,'repository_id':924883209}


def require(value,message):
    if not value:raise ValueError(message)


def verify_run(manifest,run):
    require(manifest['inputSourceRun']==EXPECTED_RUN,'Original MAIN MST source run pin differs')
    lineage=manifest['inputArtifact']['workflow_run']
    require(lineage['id']==EXPECTED_RUN['id']and lineage['head_sha']==EXPECTED_RUN['head_sha']and lineage['head_branch']==EXPECTED_RUN['head_branch'],'Original input artifact run pin differs')
    require(all(run.get(k)==EXPECTED_RUN[k]for k in ['id','head_sha','head_branch','path','run_attempt']),'Foreign original MAIN MST workflow/run/head/attempt')
    require(run.get('head_commit',{}).get('tree_id')==EXPECTED_RUN['tree'],'Foreign original MAIN MST controller tree')
    require(run.get('repository',{}).get('full_name')==REPOSITORY and run['repository'].get('id')==EXPECTED_RUN['repository_id'],'Foreign original MAIN MST repository')
    require(run.get('event')=='push'and run.get('status')=='completed'and run.get('conclusion')=='success','Original MAIN MST run did not complete successfully')


def verify_artifact(manifest,metadata):
    expected=manifest['inputArtifact']
    require(all(metadata.get(k)==expected[k]for k in ['id','name','size_in_bytes','digest','workflow_run']),'Authenticated original MAIN MST artifact identity differs')
    require(metadata.get('expired')is False,'Original MAIN MST artifact is expired or unknown')
    require(type(metadata['size_in_bytes'])is int and 0<metadata['size_in_bytes']<=256*1024*1024,'Original MAIN MST ZIP size out of bounds')
    lineage=metadata['workflow_run']
    require(lineage['repository_id']==lineage['head_repository_id']==EXPECTED_RUN['repository_id'],'Foreign original MAIN MST artifact repository')


def verify_zip(manifest,raw,output):
    require(len(raw)==manifest['inputArtifact']['size_in_bytes']and hashlib.sha256(raw).hexdigest()==manifest['inputArtifact']['digest'][7:],'Input is not exact original MAIN MST API server ZIP')
    archive=output/'original-input.zip';archive.write_bytes(raw)
    with zipfile.ZipFile(archive)as zipped:
        names=zipped.namelist()
        require(len(names)==len(set(names))and all(not PurePosixPath(n).is_absolute()and '..'not in PurePosixPath(n).parts for n in names),'Unsafe original MAIN MST ZIP')
        for name,pin in manifest['inputMembers'].items():
            require(PurePosixPath(name).name==name,'Unsafe selected output name')
            data=zipped.read(pin['member'])
            require(len(data)==pin['bytes']and hashlib.sha256(data).hexdigest()==pin['sha256'],'Original MAIN MST member differs: '+name)
            (output/name).write_bytes(data)


def download(manifest,output,client):
    item=manifest['inputArtifact'];lineage=item['workflow_run']
    run=client.api_get('/repos/'+REPOSITORY+'/actions/runs/'+str(lineage['id']));verify_run(manifest,run)
    metadata=client.api_get('/repos/'+REPOSITORY+'/actions/artifacts/'+str(item['id']));verify_artifact(manifest,metadata)
    raw=client.download(item['id'],item['size_in_bytes']);verify_zip(manifest,raw,output)
    return {'artifact':metadata,'sourceRun':run,'originalZipSha256':hashlib.sha256(raw).hexdigest(),'exactMembers':manifest['inputMembers']}
