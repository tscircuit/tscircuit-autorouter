#!/usr/bin/env python3
"""Three source-pinned candidate-only cache diagnostics; no performance credit."""
import argparse
import hashlib
import importlib.util
import inspect
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
CAMPAIGN = "cache-shadow-diagnostic-20261029"
MANIFEST = ROOT / "cache-shadow-diagnostic-20261029.json"
AUTHORITY = ROOT / "future-cache-experiment-20261029.json"
WORKFLOW = REPO / ".github/workflows/cache-shadow-diagnostic.yml"
CASES = [("srj18",14),("srj24",2),("srj24",17)]
ARM = "B"
ORDER = "DIAGNOSTIC_SINGLE_CANDIDATE"

def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,ROOT/filename)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

common=load("shadow_frozen_native_runtime","run-future-cache-experiment.py")
require,sha,exact=common.require,common.sha,common.exact

def contract():return json.loads((ROOT/"cache-shadow-contract.json").read_text())

def assets():
    return set(common.ASSETS)|{"run-future-cache-experiment.py","run-cache-shadow-diagnostic.py","cache-shadow-contract.json","seal-cache-shadow-manifest.py","framed-artifact-log.py","tests/cache-shadow-diagnostic-integrity.py"}

def validate():
    m=json.loads(MANIFEST.read_text());authority=common.validate_manifest(AUTHORITY)
    require(m.get("campaign")==CAMPAIGN and m.get("diagnosticType")=="CACHE_SHADOW","Wrong diagnostic campaign")
    require(m.get("diagnosticOnly") is True and m.get("cpuProfiling") is False and m.get("optimizationTimingCredit") is False and m.get("solvedBoardCredit") is False and m.get("actualBaselineExecution") is False,"Diagnostic credit policy changed")
    require(type(m.get("candidateExecutions")) is int and m["candidateExecutions"]==3 and type(m.get("sampleTimeoutSeconds")) is int and m["sampleTimeoutSeconds"]==360 and all(type(m.get(k)) is int and m[k]==1 for k in ["threads","concurrency","effort"]),"Three fixed candidate-only cases required")
    require(m.get("admittedContextsOnly") is True and m.get("wholeFunctionProfilerPoolScalingCredit") is False and m.get("admissionScope")==contract()["admissionScope"],"Admission/prefix scope changed")
    require([(x.get("dataset"),x.get("sample")) for x in m.get("cases",[])]==CASES,"Wrong selected original cases")
    require(m.get("authoritySha256")==sha(AUTHORITY) and m.get("harnessSha")==common.MAIN,"Frozen authority/harness changed")
    require(m.get("workflowSha256")==sha(WORKFLOW) and set(m.get("runtimeSourceHashes",{}))==assets() and all(sha(ROOT/n)==h for n,h in m["runtimeSourceHashes"].items()),"Diagnostic helper bytes changed")
    require(m.get("runSampleSourceSha256")==hashlib.sha256(inspect.getsource(common.pinned.run_sample).encode()).hexdigest(),"Fresh native runner changed")
    require(all(x["inputHash"]==authority["expectedInputHashesByDataset"][x["dataset"]][str(x["sample"])] for x in m["cases"]),"Original input identity changed")
    item=m.get("candidate",{});require(item.get("id")=="cache-shadow-diagnostic" and item.get("pr")==3199 and item.get("option")=="experimentFuturePointCache","Wrong diagnostic source/flag lineage");require(exact(item.get("coverageContract"),authority["experiments"][0]["coverageContract"]),"Candidate16 schema changed");paths=[contract()["candidatePath"],contract()["shadowPath"]]
    require(common.digest(item.get("candidateSha")) and common.digest(item.get("candidateTree")),"PENDING_SOURCE_PUBLICATION: source must be sealed before launch")
    require(item.get("options")=={"cacheProvider":None,"effort":1,"experimentFuturePointCache":True} and item.get("evidencePaths")==paths,"Exact flag/two actual main ledgers required")
    require(item.get("solverName")==common.SOLVER and item.get("solverModule")==common.MODULE,"Wrong actual solver")
    require(item.get("sourceIsCurrentPrHead") is False and isinstance(item.get("sourceBranch"),str) and item["sourceBranch"] and item["sourceBranch"]!="experiment/pipeline9-1","Diagnostic source requires a separate branch")
    q=item.get("sourceQualification",{});require(q.get("status")=="PASS_ROOT_REVIEWED" and q.get("sourceTree")==item["candidateTree"] and all(type(q.get(k)) is int and q[k]==0 for k in ["fullTypesExitCode","fullBuildExitCode","focusedTestsExitCode"]),"Source QA missing")
    text=q.get("evidenceText");require(isinstance(text,str) and hashlib.sha256(text.encode()).hexdigest()==q.get("evidenceSha256"),"Source receipt bytes differ")
    receipt=json.loads(text);require(receipt.get("sourceTree")==item["candidateTree"] and receipt.get("localCommit")==item.get("publication",{}).get("reviewedLocalCommit"),"Source receipt belongs to another tree")
    require(item["publication"]["publishedCommit"]==item["candidateSha"] and item["publication"]["expectedTree"]==item["candidateTree"],"Source publication differs")
    return m,authority

def expected_cp(m,case):
    return {"campaign":CAMPAIGN,"arm":ARM,"algorithmSha":m["candidate"]["candidateSha"],"dataset":case["dataset"],"originalSample":case["sample"],"inputSha256":case["inputHash"],"observerSourceSha256":m["runtimeSourceHashes"]["phase-checkpoint-observer.ts"],"executionOrder":ORDER,"githubRunId":os.environ.get("GITHUB_RUN_ID"),"controllerSha":os.environ.get("GITHUB_SHA")}

def census(record,m,case,cp_expected):
    c=contract();cp=record.get("phaseCheckpointAudit") or {};last=cp.get("lastDurableCheckpoint") or {}
    static={"campaign":CAMPAIGN,"arm":ARM,"algorithmSha":m["candidate"]["candidateSha"],"dataset":case["dataset"],"originalSample":case["sample"],"inputSha256":case["inputHash"],"observerSourceSha256":m["runtimeSourceHashes"]["phase-checkpoint-observer.ts"],"executionOrder":ORDER}
    selected=any(exact(value,case) for value in m["cases"])
    expected_bound=selected and common.digest(m["candidate"].get("candidateSha")) and all(exact(cp_expected.get(k),v) for k,v in static.items())
    bound=expected_bound and cp.get("errors")==[] and all(v is not None and exact(last.get(k),v) for k,v in cp_expected.items()) and last.get("observedObjectPath")=="solver" and last.get("observedConstructorName")==common.SOLVER and last.get("actualCacheProviderState")=="disabled" and exact(last.get("observedRequestedOptions"),m["candidate"]["options"])
    entered,finished=False,False
    for row in cp.get("stageBoundaries",[]):
        if row.get("phaseName")==c["stageName"]:
            entered=True
            if row.get("event")=="on_solved_exit":finished=True
        elif entered and row.get("event")=="phase_setup_enter":finished=True
    metrics=(record.get("official") or {}).get("routingMetrics")
    raw_audit=metrics.get("experimentAudit") if isinstance(metrics,dict) else None
    audit=raw_audit if isinstance(raw_audit,dict) else {}
    evidence=audit.get("evidence") if audit.get("inputHash")==case["inputHash"] else None
    if not isinstance(evidence,dict):evidence=last.get("evidence") or {}
    primary,shadow=evidence.get(c["candidatePath"]),evidence.get(c["shadowPath"])
    primary_fields=m["candidate"]["coverageContract"]["countFields"]
    numeric=lambda value,fields:isinstance(value,dict) and set(value)==set(fields) and all(type(value[k]) is int and value[k]>=0 for k in fields)
    primary_validation=common.coverage_module.coverage({"arm":"B","official":{"routingMetrics":{"experimentAudit":{"evidence":evidence}}},"phaseCheckpointAudit":cp},m["candidate"])
    valid=numeric(primary,primary_fields) and numeric(shadow,c["shadowFields"]) and primary_validation["counterEvidenceComplete"]
    divergence=isinstance(shadow,dict) and type(shadow.get("indexMismatches")) is int and shadow["indexMismatches"]>0
    checks=[]
    if valid:
        for left,right in [("lookups",["legacyHits","legacyMisses"]),("lookups",["candidateHits","candidateMisses"]),("lookups",["bothHits","legacyOnlyHits","candidateOnlyHits","bothMisses"]),("legacyHits",["bothHits","legacyOnlyHits"]),("candidateHits",["bothHits","candidateOnlyHits"]),("legacyHits",["assertedLegacyHits"])]:checks.append(shadow[left]==sum(shadow[k] for k in right))
        for left,right in [("instances","instances"),("lookups","lookups"),("hits","candidateHits"),("misses","candidateMisses"),("distanceEvaluations","candidateDistanceEvaluations"),("invalidations","invalidations"),("uncacheableQueries","uncacheableQueries")]:checks.append(primary[left]==shadow[right])
        checks.extend([shadow["indexMismatches"]==0,primary["lookups"]==primary["hits"]+primary["misses"],primary["misses"]==primary["stores"]+primary["uncacheableQueries"],primary["stores"]==primary["coldStores"]+primary["evictions"]])
    coherent=valid and all(checks)
    final=bool(bound and finished)
    status="INDEX_DIVERGENCE_DIAGNOSTIC_FAILURE" if divergence else "COMPLETE_HD_DIAGNOSTIC_CENSUS" if final and coherent else "INCOMPLETE_OR_INVALID_COMPLETE_HD_CENSUS" if final else "OBSERVED_QUERY_PREFIX_LATER_WORK_UNKNOWN" if bound and coherent else "COUNTERS_OR_SOURCE_UNAVAILABLE"
    return {"status":status,"counterCensusFinal":final,"counterEvidenceComplete":coherent,"actualOwnedQueryPrefixObserved":bool(bound and coherent and shadow["lookups"]>0),"indexDivergenceObserved":divergence,"candidateCounts":primary,"shadowCounts":shadow,"counterfactualLegacyMinusCandidatePointEvaluations":shadow["legacyDistanceEvaluations"]-shadow["candidateDistanceEvaluations"] if coherent else None,"semantics":c["semantics"],"admittedContextsOnly":True,"admissionScope":c["admissionScope"],"wholeFunctionProfilerPoolScalingCredit":False,"actualBaselineExecution":False,"independentCorrectnessOracleOnMisses":False,"optimizationTimingCredit":False,"solvedBoardCredit":False,"wholeOutputCredit":False}

def qualify_diagnostic_record(record,m,authority,case,cp):
    common.qualify_record(record,authority,m["candidate"])
    record["durableTimeoutSourceQualification"]=common.timeout_checkpoint_qualification(record)
    record["shadowDiagnostics"]=census(record,m,case,cp)
    record["featureCoverage"]={"diagnosticOnly":True,"optimizationAttributionEligible":False,"actualWorkExercised":record["shadowDiagnostics"]["actualOwnedQueryPrefixObserved"]}
    record.update(diagnosticOnly=True,diagnosticType="CACHE_SHADOW",cpuProfiling=False,optimizationTimingCredit=False,solvedBoardCredit=False,actualBaselineExecution=False)
    return record

def run(args,m,authority):
    case=next((x for x in m["cases"] if (x["dataset"],x["sample"])==(args.dataset,args.sample)),None);require(case is not None,"Unknown diagnostic case")
    checkout=args.checkout.resolve();output=args.output.resolve();require(not output.exists() or not any(output.iterdir()),"Fresh diagnostic output required")
    item=m["candidate"];common.verify_checkouts(authority,item,{"B":checkout});common.verify_dependencies(authority,{"B":checkout})
    identities=common.pinned.read_identity(checkout,args.dataset);require({str(x["sampleNumber"]):x["inputHash"] for x in identities}==authority["expectedInputHashesByDataset"][args.dataset],"Exact original source population changed")
    identity=next(x for x in identities if x["sampleNumber"]==args.sample);require(identity["inputHash"]==case["inputHash"],"Selected original input changed")
    harness=json.loads((checkout/"experiment-harness-provenance.json").read_text());require(harness.get("checkoutSha")==item["candidateSha"] and harness.get("validators")==authority["expectedValidatorHashes"] and all(harness.get(k)==v for k,v in authority["expectedHarnessSourceHashes"].items()),"Adapted native source/harness differs")
    cp=expected_cp(m,case);config=dict(item,phaseCheckpoint=cp)
    common.pinned.write_json(output/"config.json",config)
    provenance={"manifest":m,"manifestSha256":sha(MANIFEST),"githubRunId":os.environ.get("GITHUB_RUN_ID"),"controllerSha":os.environ.get("GITHUB_SHA"),"githubRunAttempt":os.environ.get("GITHUB_RUN_ATTEMPT"),"githubJobKey":os.environ.get("GITHUB_JOB"),"sourceSha":item["candidateSha"],"sourceTree":item["candidateTree"],"inputIdentity":identity,"harness":harness,"diagnosticType":"CACHE_SHADOW","diagnosticOnly":True,"admittedContextsOnly":True,"admissionScope":m["admissionScope"],"wholeFunctionProfilerPoolScalingCredit":False,"cpuProfiling":False,"optimizationTimingCredit":False,"solvedBoardCredit":False,"transportIdentity":"PRODUCER_FRAMED_INNER_ZIP_NOT_ORIGINAL_API_SERVER_ZIP"}
    common.pinned.write_json(output/"profile-provenance.json",provenance)
    record=common.pinned.run_sample(checkout,output/"config.json",output/"attempt",args.dataset,args.sample,360)
    record.update(campaign=CAMPAIGN,experiment="cache-shadow-diagnostic",pr=3199,dataset=args.dataset,sampleNumber=args.sample,arm=ARM,round=1,executionOrder=ORDER,requestedOptions=item["options"],sha=item["candidateSha"],solverName=common.SOLVER,expectedInputHash=case["inputHash"],qualificationMode="diagnostic")
    common.declared.qualify_output(record,output/"attempt",checkout,authority,ROOT,common.pinned.execute_with_deadline)
    record["phaseCheckpointAudit"]=common.checkpoint_audit(output/"attempt/raw",cp)
    qualify_diagnostic_record(record,m,authority,case,cp)
    common.pinned.write_json(output/"profile-result.json",record)
    print("CACHE_SHADOW_DIAGNOSTIC_RESULT_JSON "+json.dumps(record,separators=(",",":")),flush=True)
    allowed_timeout_gaps={"Actual factory input/options/cache identity unproven","Actual solver/sample/deadline identity differs","Timing observations missing"}
    require(record["strictIntegrityQualified"] or (record["durableTimeoutSourceQualification"]["sourceAndInputProvenByBoundedCheckpoints"] and set(record["strictIntegrityIssues"])==allowed_timeout_gaps),"Diagnostic source/outcome integrity unproven; raw attempt retained")
    require(not record["shadowDiagnostics"]["indexDivergenceObserved"],"Shadow hit-index divergence; diagnostic failure without fallback")
    require(record["phaseCheckpointAudit"]["errors"]==[] and not record.get("controllerError") and not record.get("supplementalValidationError") and not record.get("declaredIntentValidationError"),"Diagnostic source/oracle/process qualification failed; raw attempt retained")
    require(not record["shadowDiagnostics"]["counterCensusFinal"] or record["shadowDiagnostics"]["counterEvidenceComplete"],"Completed HD requires both complete coherent actual16 ledgers")

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--mode",choices=["plan","select","verify-checkout","verify-dependencies","run"],required=True);parser.add_argument("--checkout",type=Path);parser.add_argument("--dataset",choices=["srj18","srj24"]);parser.add_argument("--sample",type=int);parser.add_argument("--output",type=Path);args=parser.parse_args();m,a=validate()
    if args.mode=="plan":common.outputs({"matrix":json.dumps({"include":[{"dataset":x["dataset"],"sample":x["sample"]} for x in m["cases"]]},separators=(",",":"))})
    elif args.mode=="select":common.outputs({"candidate_sha":m["candidate"]["candidateSha"],"harness_sha":common.MAIN})
    elif args.mode=="verify-checkout":common.verify_checkouts(a,m["candidate"],{"B":args.checkout.resolve()})
    elif args.mode=="verify-dependencies":common.verify_dependencies(a,{"B":args.checkout.resolve()})
    else:run(args,m,a)

if __name__=="__main__":main()
