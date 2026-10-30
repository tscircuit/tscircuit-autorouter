"""Explicit N/P/F triplet original-serverZIP proof; no cross-role output/work parity."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import zipfile
ROOT=Path(__file__).resolve().parent

def load(name,path):
    s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
runtime=load('semantic_mst_raw_runtime',ROOT/'run-owner-root-memo126.py')
carrier=load('semantic_mst_raw_carrier',ROOT/'owner-root-memo126-artifact-carrier.py')
CHECKS={'viaPad','padTrace','viaTrace','traceOverlap','differentNetViaSpacing','sameNetViaSpacing','padPad'}

def digest(value):return hashlib.sha256(value).hexdigest()

def read_json(archive,name):return json.loads(archive.read(name))

def output_facts(raw,target,record,common):
    audit=record['official']['routingMetrics']['experimentAudit']
    assert common.exact(read_json(raw,target+'capture-provenance.json'),audit)
    compact=record['declaredIntentCopper']
    hashes={name:digest(raw.read(target+name))for name in common.declared.INPUTS}
    assert hashes==compact['inputHashes']and hashes['original-input.json']==record['expectedInputHash']
    report_bytes=raw.read(target+'declared-intent-via-pad.json');report=json.loads(report_bytes)
    assert digest(report_bytes)==compact['reportSha256']and report['inputHashes']==hashes
    assert report['sidecarSourceSha256']==common.DECLARED_SOURCE_SHA256 and report['checker']['moduleSha256']==common.CHECKER_SOURCE_SHA256 and report['checker']['version']=='0.0.259'
    assert type(report['checksRun'])is list and len(report['checksRun'])==7 and set(report['checksRun'])==CHECKS and report['allPublishedCopperChecksRun']is True
    for key in ['schemaVersion','status','qualifiedSupportedCopper','ownershipCoverageStatus','allPublishedCopperChecksRun','checksRun','geometryUnchanged','canonicalSemanticSha256','copperGeometrySha256',*common.declared.COUNTS]:
        assert common.exact(report[key],compact[key])
    for name in CHECKS:
        assert common.exact({key:report['checks'][name][key]for key in['count','knownForeignFindingCount','unknownFindingCount','sameOwnerRuleFindingCount']},compact['perCheckCounts'][name])
    assert common.exact({key:report['originalObstacleCoverage'][key]for key in['originalCount','representedCount','unmappedCount','unmappedDeclaredCopperCount']},compact['originalObstacleCoverage'])
    inventory=digest(json.dumps(report['allFindings'],sort_keys=True,separators=(',',':')).encode())
    assert inventory==compact['findingInventorySha256']
    assert hashes['canonical-circuit-json.json']==compact['canonicalSemanticSha256']==record['supplemental']['canonicalCircuitJsonSha256']
    assert hashes['raw-new-traces.json']==audit['rawNewTracesHash']and digest(raw.read(target+'raw-solver-output.json'))==audit['rawOutputHash']
    supplemental=read_json(raw,target+'supplemental-validation.json')
    assert common.exact(common.pinned.compact_checks(supplemental),record['supplemental'])
    assert all(key in supplemental and common.exact(supplemental[key],value)for key,value in audit.items())
    assert all(type(supplemental[name]['errors'])is list and len(supplemental[name]['errors'])==supplemental[name]['count']for name in common.CHECKS)
    return {'rawInputFileSha256':hashes,'rawSolverOutputSha256':audit['rawOutputHash'],'declaredIntentStatus':report['status'],
            'declaredIntentReportSha256':digest(report_bytes),'findingInventorySha256':inventory,
            'supplementalFullReportSha256':digest(raw.read(target+'supplemental-validation.json'))}

def match_producer_upload(log_text, expected_artifact):
    latest_upload_digest, finalized = None, []
    for line in log_text.splitlines():
        payload = re.sub(r"^\ufeff?(?:\d{4}-\d{2}-\d{2}T\S+Z\s+)?", "", line)
        found = re.fullmatch(r"SHA256 digest of uploaded artifact zip is ([0-9a-f]{64})", payload)
        if found: latest_upload_digest = found.group(1)
        found = re.fullmatch(r"Artifact " + re.escape(expected_artifact["name"]) + r"\.zip successfully finalized\. Artifact ID ([0-9]+)", payload)
        if found: finalized.append((int(found.group(1)),latest_upload_digest))
    assert finalized == [(expected_artifact["id"], expected_artifact["sha256"])], "Exact producer upload artifact ID/name/digest association missing"
    return {"matchingFinalizedLines":len(finalized),"artifactId":expected_artifact["id"],"artifactName":expected_artifact["name"],"artifactSha256":expected_artifact["sha256"]}

class ZipPath:
    """Read-only minimal pathlib surface for the frozen checkpoint auditor."""
    def __init__(self,archive,name):self.archive,self.name=archive,name.rstrip("/")
    def __truediv__(self,name):return ZipPath(self.archive,self.name+"/"+str(name))
    def read_bytes(self):return self.archive.read(self.name)
    def read_text(self):return self.read_bytes().decode("utf-8")
    def exists(self):return self.name in self.archive.namelist()


def qualify(dataset,shard_index,parsed_path,log_path,raw_path,artifacts_path,jobs_path,run_path,carrier_logs_path,job_id,run_id,head):
    m,a=runtime.validate();common=runtime.common;shard=runtime.select_shard(m,dataset,shard_index)
    parsed=json.loads(parsed_path.read_bytes());replay=runtime.parse_log(log_path.read_text(),m,a,shard,run_id,head)
    assert common.exact(parsed,replay) and parsed['sourceQualified']is True and parsed['summary']['populationComplete']is True
    run,jobs,arts=[json.loads(p.read_bytes())for p in[run_path,jobs_path,artifacts_path]]
    assert run['id']==int(run_id)and run['head_sha']==head and run['run_attempt']==1 and run['path']=='.github/workflows/owner-root-memo126-20261030.yml'and run['event']=='push'and run['head_branch']==runtime.BRANCH
    assert jobs['runId']==arts['runId']==run_id and jobs['allApiPagesRetrieved']is True and arts['allApiPagesRetrieved']is True
    assert len(jobs['jobs'])==jobs['total_count']==len({j['id']for j in jobs['jobs']})and len(arts['artifacts'])==arts['total_count']==len({v['id']for v in arts['artifacts']})
    matched=[j for j in jobs['jobs']if j['id']==job_id];assert len(matched)==1;job=matched[0]
    assert job['name']==f'owner-root-memo126-shard / {dataset} / {shard_index}'and job['run_id']==int(run_id)and job['head_sha']==head and job['run_attempt']==1 and job['status']=='completed'
    for label in ['Verify source trees and unchanged current-main validators','Verify complete installed pinned dependency source bytes','Build native','Build original','Build fast','Prepare identical current-main harness and bounded observer','Retain exact inputs, output copper, checks, stage evidence and failures separately']:
        assert len([s for s in job['steps']if s['name']==label and s['conclusion']=='success'])==1
    assert len([s for s in job['steps']if s['name']=='Run every prospectively ordered original case triplet in this exact shard'and s['conclusion']in['success','failure']])==1
    name=f'owner-root-memo126-raw-owner-root-memo126-{dataset}-shard{shard_index}';matched=[v for v in arts['artifacts']if v['name']==name];assert len(matched)==1;artifact=matched[0]
    source=carrier.run_pin(run,run_id=run_id,controller_sha=head,repository=carrier.REPOSITORY);pin=carrier.artifact_pin(artifact,source)
    assert raw_path.stat().st_size==pin['whole_bytes']and digest(raw_path.read_bytes())==pin['whole_sha256']
    upload=match_producer_upload(log_path.read_text(),{'id':artifact['id'],'name':name,'sha256':pin['whole_sha256']})
    logs=json.loads(carrier_logs_path.read_bytes());count=(pin['whole_bytes']+carrier.PART_BYTES-1)//carrier.PART_BYTES
    selected=[j for j in jobs['jobs']if j['name']in{carrier.job_name(pin['artifact_id'],n)for n in range(count)}]
    with tempfile.TemporaryDirectory(prefix='mst-original-zip-replay-')as temporary:
        reconstructed=Path(temporary)/'original.zip';transport=carrier.restore(logs,reconstructed,expected_artifact=artifact,expected_run=run,expected_jobs=selected,expected_manifest_sha256=runtime.sha(runtime.MANIFEST));assert reconstructed.read_bytes()==raw_path.read_bytes()
    audit=[];prefix=f'owner-root-memo126-{dataset}-shard{shard_index}/'
    with zipfile.ZipFile(raw_path)as raw:
        names=raw.namelist();assert len(names)==len(set(names))and all(n.startswith(prefix)and not Path(n).is_absolute()and'..'not in Path(n).parts for n in names)
        rows=[json.loads(line)for line in raw.read(prefix+'results.jsonl').splitlines()];assert common.exact(rows,parsed['records'])and common.exact(read_json(raw,prefix+'summary.json'),parsed['summary'])
        p=read_json(raw,prefix+'provenance.json');assert common.exact(p['manifest'],m)and p['manifestSha256']==runtime.sha(runtime.MANIFEST)and common.exact(p['shard'],shard)and p['githubRunId']==run_id and p['controllerSha']==head and p['runAttempt']=='1'
        assert p['schemaVersion']==2
        assert p['fullUnionCases']==42 and p['plannedFullUnionAttempts']==126 and p['plannedFullUnionShards']==11 and p['timingsPooledWithPriorCampaigns']is False
        population=p['fullOriginalPopulation'];assert[value['sampleNumber']for value in population]==list(range(1,common.COUNTS[dataset]+1))and{str(v['sampleNumber']):v['inputHash']for v in population}==a['expectedInputHashesByDataset'][dataset]
        original={v['sampleNumber']:v for v in population};assert common.exact(p['selectedOriginalInputs'],[original[c['sample']]for c in shard['cases']])
        assert common.exact(runtime.compare_dependencies(p['harnesses']),p['dependencyComparison'])
        for arm in runtime.ROLES:
            h=p['harnesses'][arm];assert h['checkoutSha']==m['roles'][arm]['candidateSha']and h['validators']==a['expectedValidatorHashes']and all(h.get(k)==v for k,v in a['expectedHarnessSourceHashes'].items())
        for record in rows:
            ordinal,arm=record['ordinalWithinShard'],record['arm'];case=shard['cases'][ordinal];sample=case['sample'];target=prefix+f'sample-{sample:03d}/{arm}/';raw_target=target+'raw/';cpmeta=runtime.expected_cp(m,shard,ordinal,arm,run_id,head)
            config=runtime.attempt_config(m,a,shard,ordinal,arm,run_id,head)
            assert common.exact(read_json(raw,prefix+f'sample-{sample:03d}/config-{arm}.json'),config)and common.exact(read_json(raw,target+'audit-result.json'),record)
            official=read_json(raw,target+'benchmark-result.json');assert common.exact(official['tests'],[record['official']])and common.exact(official['runtime'],record['officialReportRuntime'])
            progress=raw_target+'latest-progress-evidence.json'
            if record.get('lastObservedEvidence')is None:assert progress not in names
            else:assert common.exact(read_json(raw,progress),record['lastObservedEvidence'])
            cp=common.checkpoint_audit(ZipPath(raw,raw_target),cpmeta);assert cp['errors']==[]and common.exact(cp,record['phaseCheckpointAudit'])
            status=cp['status'];assert type(status['rowsWritten'])is int and 3<=status['rowsWritten']<=cp['rowCount']
            if status.get('solveFinished')is True:assert status['rowsWritten']==cp['rowCount']
            rawview=ZipPath(raw,raw_target);emitted=runtime.audit_pointpairs(record,rawview);assert common.exact(emitted,record['pointPairRequirementAudit']);transition=runtime.audit_transitions(record,rawview);assert common.exact(transition,record['rawTransitionAudit'])
            solved=record['official']['didSolve']is True
            fact={'sample':sample,'ordinalWithinShard':ordinal,'arm':arm,'role':m['roles'][arm]['roleName'],'recordSchema':'EXPLICIT_N_P_F_TRIPLET_V1','executionOrder':case['order'],'sourceSha':record['sha'],'inputHash':record['expectedInputHash'],'originalStrictIntegrityQualified':record['strictIntegrityQualified'],'originalStrictIntegrityIssues':record['strictIntegrityIssues'],'didSolve':record['official']['didSolve'],'didTimeout':record['official']['didTimeout'],'separateTimeoutQualification':record['durableTimeoutSourceQualification'],'featureCoverage':record['featureCoverage'],'nonterminalFeatureObservations':record['nonterminalFeatureObservations'],'pointPairRequirementAudit':emitted,'rawTransitionAudit':transition,'scopedSevenGradeIsNotElectricalPass':True,'checkpointBytesSha256':digest(raw.read(raw_target+'phase-checkpoints.jsonl')),'checkpointRows':cp['rowCount'],'rawOriginalInputBytesVerified':solved,'completedOutputGeometryCredit':solved,'crossArmParityRequired':False,'logicalMechanismIsNotElectricalPass':True}
            if solved:fact.update(output_facts(raw,raw_target,record,common))
            audit.append(fact)
    return {'schemaVersion':2,'recordSchema':'EXPLICIT_N_P_F_TRIPLET_V1','status':'PASS_ORIGINAL_SERVER_ZIP_AND_ALL_SOURCE_BOUND_TRIPLET_SHARD_RECORD_BYTES','campaign':runtime.CAMPAIGN,'runId':run_id,'controllerSha':head,'manifestSha256':runtime.sha(runtime.MANIFEST),'experiment':'owner-root-memo126','dataset':dataset,'shardIndex':shard_index,'shardCount':shard['shardCount'],'shard':shard,'jobId':job_id,'records':len(rows),'sourceSha':runtime.SOURCE,'sourceTree':runtime.TREE,'roles':m['roles'],'baselineSha':common.MAIN,'parsedPath':str(parsed_path),'parsedSha256':digest(parsed_path.read_bytes()),'rawLogSha256':digest(log_path.read_bytes()),'authenticatedJobMetadataSha256':digest(jobs_path.read_bytes()),'authenticatedArtifactMetadataSha256':digest(artifacts_path.read_bytes()),'artifacts':{'raw':{'id':artifact['id'],'name':name,'path':str(raw_path),'sha256':pin['whole_sha256'],'bytes':raw_path.stat().st_size}},'producerUploadProof':{'jobId':job_id,'runAttempt':1,'headSha':head,'rawArtifactId':artifact['id'],'rawArtifactName':name,'rawArtifactSha256':pin['whole_sha256'],'matchingFinalizedLines':upload['matchingFinalizedLines']},'authenticatedCarrierReceipt':transport,'compactMetricsReadFromSameOriginalRawServerZip':True,'originalStrictFlagsAndTimeoutsPreserved':True,'recordsAudit':audit,'summary':parsed['summary'],'requiresFullUnionIndependentRawReceiptCount':11,'fullCorpusClaim':True,'crossArmOutputGeometryOrNativeWorkParityRequired':False,'timingsPooledWithPriorCampaigns':False,'clockCorrectionApplied':False,'scope':'One exact predeclared full42/126 triplet LPT shard. Every explicit N/P/F role source/input/runtime/budget/physical finding and original-serverZIP byte retained. Output/pointpair/work differences are expected outcomes, not invalidity. N has no feature; P/F both expose15scalarv2 with full7admission/reference2; only F adds the fresh per-invocation owner-root index. MST marker and emitted logical requirement coverage are distinct from final electrical PASS; All11 independently approved originalZIP receipts required for full42 attribution; no prior clocks pooled.'}

def main():
    p=argparse.ArgumentParser()
    for key in['dataset','parsed','job-log','raw-zip','artifact-metadata','job-metadata','run-metadata','carrier-logs','run-id','controller-sha','output']:p.add_argument('--'+key,required=True)
    p.add_argument('--shard',type=int,required=True);p.add_argument('--producer-job-id',type=int,required=True);v=p.parse_args();out=Path(v.output);assert not out.exists();result=qualify(v.dataset,v.shard,Path(v.parsed),Path(v.job_log),Path(v.raw_zip),Path(v.artifact_metadata),Path(v.job_metadata),Path(v.run_metadata),Path(v.carrier_logs),v.producer_job_id,v.run_id,v.controller_sha);out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k]for k in['status','dataset','shardIndex','records']}))

if __name__=='__main__':main()
