import pathlib,json,copy,importlib.util,hashlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location('independent_post588_runtime',ROOT/'run-post588-experiments.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
manifest=json.loads((ROOT/'post588-experiments-20261029.json').read_text()); item=copy.deepcopy(manifest['experiments'][0]);item['candidateSha']='1'*40
z='0'*64
record={'arm':'B','sha':item['candidateSha'],'sampleNumber':1,'expectedInputHash':z,'requestedOptions':copy.deepcopy(item['options']),'externalBenchmarkProcessWallMs':200,'controllerError':None,'supplementalValidationError':None,'declaredIntentValidationError':None,'phaseCheckpointAudit':{'errors':[]},'officialReportRuntime':{'threadsPerSample':1,'effectiveThreadsPerSample':1,'cpuBudgetPerSample':1,'requestedConcurrency':1,'workerCount':1,'bunVersion':'1.4.2'},'official':{'solverName':m.SOLVER,'sampleNumber':1,'sampleTimeoutMs':360000,'didSolve':True,'didTimeout':False,'relaxedDrcPassed':True,'elapsedTimeMs':100,'routingMetrics':{'experimentAudit':{'inputHash':z,'inputMutated':False,'options':item['options'],'actualCacheProviderState':'disabled','actualConstructorName':m.SOLVER,'actualSolverName':m.SOLVER,'solverModule':m.MODULE,'solverSolved':True,'solverFailed':False,'solverError':None,'constructorTimeMs':1,'rawOutputHash':z,'rawNewTracesHash':z,'evidence':{item['coverageContract']['statsPath']:{'activated':True,'nodeCount':2,'boundaryQueries':8,'targetQueries':0,'incidentVisits':0}}}}},'supplemental':{'canonicalCircuitJsonSha256':z,'physicalCopper':{'combinedRouteViaCount':0,'uniqueOwnedViaSiteSpanCount':0,'uniqueOwnedManufacturedViaSiteCount':0,'foreignOwnerCoincidentViaSiteSpans':0,'combinedRoutePointCount':2,'combinedCopperLength':1.0,'exactSegmentDeduplicatedCopperLength':1.0}},'declaredIntentCopper':{'schemaVersion':2,'status':'PASS','qualifiedSupportedCopper':True,'ownershipCoverageStatus':'COMPLETE','allPublishedCopperChecksRun':True,'checksRun':sorted(m.declared.CHECKS),'geometryUnchanged':True,'exactRetainedInputBytesVerified':True,'canonicalSemanticSha256':z,'copperGeometrySha256':z,'reportSha256':z,'findingInventorySha256':z,'sidecarSourceSha256':m.DECLARED_SOURCE_SHA256,'checker':{'moduleSha256':m.CHECKER_SOURCE_SHA256,'version':'0.0.259'},'inputHashes':{name:z for name in m.declared.INPUTS},'originalObstacleCoverage':{'unmappedDeclaredCopperCount':0}}}
for k in m.CHECKS:record['supplemental'][k]={'count':0,'byType':{}}
for k in m.declared.COUNTS:record['declaredIntentCopper'][k]=0
contract=item['coverageContract']
stats={contract['activationField']:contract['activationValue'],contract['eligibleField']:2,contract['executedField']:3}
for field in contract['changedFields']+contract['positivePrerequisites']:stats[field]=1
for field in contract['truePrerequisites']:stats[field]=True
for left,right in contract['greaterThanFields']:stats[right]=2;stats[left]=3
record['official']['routingMetrics']['experimentAudit']['evidence']={path:(stats if path==contract['statsPath'] else {}) for path in item['evidencePaths']}
m.qualify_record(record,manifest,item);assert record['strictIntegrityQualified'],record['strictIntegrityIssues'];assert m.physical_clean(record)
controls=[]
def reject(name,mutation):
 r=copy.deepcopy(record);mutation(r);m.qualify_record(r,manifest,item);assert not r['strictIntegrityQualified'],name;controls.append(name)
reject('wrong source SHA',lambda r:r.update(sha='2'*40))
reject('wrong sample',lambda r:r['official'].update(sampleNumber=2))
reject('wrong deadline',lambda r:r['official'].update(sampleTimeoutMs=100))
reject('mutated input',lambda r:r['official']['routingMetrics']['experimentAudit'].update(inputMutated=True))
reject('flag OFF',lambda r:r['official']['routingMetrics']['experimentAudit']['options'].update({item['option']:False}))
reject('wrong constructor',lambda r:r['official']['routingMetrics']['experimentAudit'].update(actualConstructorName='OtherSolver'))
reject('cache enabled',lambda r:r['official']['routingMetrics']['experimentAudit'].update(actualCacheProviderState='present'))
reject('bool elapsed',lambda r:r['official'].update(elapsedTimeMs=True))
reject('negative constructor clock',lambda r:r['official']['routingMetrics']['experimentAudit'].update(constructorTimeMs=-1))
reject('short process clock',lambda r:r.update(externalBenchmarkProcessWallMs=10))
reject('thread count two',lambda r:r['officialReportRuntime'].update(effectiveThreadsPerSample=2))
reject('thread boolean',lambda r:r['officialReportRuntime'].update(workerCount=True))
reject('wrong Bun',lambda r:r['officialReportRuntime'].update(bunVersion='1.3.0'))
reject('contradictory solve timeout',lambda r:r['official'].update(didTimeout=True))
reject('contradictory failed actual solver',lambda r:r['official']['routingMetrics']['experimentAudit'].update(solverFailed=True))
reject('bad output digest',lambda r:r['official']['routingMetrics']['experimentAudit'].update(rawNewTracesHash='bad'))
reject('negative copper count',lambda r:r['supplemental']['physicalCopper'].update(uniqueOwnedManufacturedViaSiteCount=-1))
reject('bool copper count',lambda r:r['supplemental']['physicalCopper'].update(combinedRouteViaCount=True))
reject('infinite copper length',lambda r:r['supplemental']['physicalCopper'].update(combinedCopperLength=float('inf')))
reject('finding totals mismatch',lambda r:r['supplemental']['viaBoardChecks'].update(count=1))
reject('wrong frozen sidecar',lambda r:r['declaredIntentCopper'].update(sidecarSourceSha256='f'*64))
reject('wrong frozen checker',lambda r:r['declaredIntentCopper']['checker'].update(moduleSha256='f'*64))
reject('missing one copper predicate',lambda r:r['declaredIntentCopper']['checksRun'].pop())
reject('known finding cannot PASS',lambda r:r['declaredIntentCopper'].update(knownForeignCopperFindingCount=1))
reject('unknown cannot PASS',lambda r:r['declaredIntentCopper'].update(unknownTraceCount=1))
reject('original copper unrepresented',lambda r:r['declaredIntentCopper']['originalObstacleCoverage'].update(unmappedDeclaredCopperCount=1))
reject('geometry changed',lambda r:r['declaredIntentCopper'].update(geometryUnchanged=False))
reject('missing point-pair byte digest',lambda r:r['declaredIntentCopper']['inputHashes'].pop('point-pair-context.json'))
a=copy.deepcopy(record);a.update(arm='A',sha=m.MAIN,requestedOptions=copy.deepcopy(manifest['baseline']['options']));a['official']['routingMetrics']['experimentAudit'].update(options=manifest['baseline']['options'],evidence={p:None for p in item['evidencePaths']});m.qualify_record(a,manifest,item);assert a['strictIntegrityQualified'];assert not a['featureCoverage']['optimizationAttributionEligible']
a['official']['routingMetrics']['experimentAudit']['evidence'][item['evidencePaths'][0]]={'activated':False};m.qualify_record(a,manifest,item);assert not a['strictIntegrityQualified'];controls.append('baseline experiment object prohibited even false')
print(json.dumps({'status':'PASS','syntheticControlsOnly':True,'actualRoutingOrCounterObservations':False,'positiveRecordAndBaseline':2,'negativeControls':len(controls),'controls':controls}))
t={'campaign':'c','arm':'B','sha':'1'*40,'dataset':'srj24','sampleNumber':1,'expectedInputHash':z,'executionOrder':'AB','requestedOptions':copy.deepcopy(item['options']),'controllerError':None,'externalBenchmarkProcessWallMs':360100,'officialReportRuntime':copy.deepcopy(record['officialReportRuntime']),'official':{'didTimeout':True,'didSolve':False,'sampleTimeoutMs':360000,'elapsedTimeMs':360000,'solverName':m.SOLVER,'sampleNumber':1},'phaseCheckpointAudit':{'errors':[],'rowCount':3,'status':{'installed':True,'solveEntered':True,'solveFinished':False,'truncated':False,'errors':[]},'stageBoundaries':[{'sequence':i,'event':e,'phaseName':None,'solved':False,'failed':False,'officialStartOffsetMs':None if i<2 else 0} for i,e in enumerate(['pipeline_constructor_enter','pipeline_constructor_exit','solve_enter'])]}}
t['phaseCheckpointAudit']['lastDurableCheckpoint']={'campaign':'c','arm':'B','algorithmSha':'1'*40,'dataset':'srj24','originalSample':1,'inputSha256':z,'executionOrder':'AB','sequence':2,'event':'solve_enter','phaseName':None,'solved':False,'failed':False,'officialStartOffsetMs':0,'observedObjectPath':'solver','observedConstructorName':m.SOLVER,'actualCacheProviderState':'disabled','observedRequestedOptions':copy.deepcopy(item['options'])}
assert m.timeout_checkpoint_qualification(t)['sourceAndInputProvenByBoundedCheckpoints']
results=[]
for case in ['external-deadline','throw-event','negative-offset','truncated','missing-chain','boolean-sequence','wrong-options','future-offset','missing-runtime','solve-throw-event','last-boundary-mismatch']:
 x=copy.deepcopy(t);cp=x['phaseCheckpointAudit']
 if case=='external-deadline':x['controllerError']='External controller deadline exceeded'
 if case=='throw-event':cp['stageBoundaries'][-1]['event']='step_throw'
 if case=='negative-offset':cp['stageBoundaries'][-1]['officialStartOffsetMs']=-1
 if case=='truncated':cp['status']['truncated']=True
 if case=='missing-chain':cp['stageBoundaries'][0]['event']='phase_run_enter'
 if case=='boolean-sequence':cp['stageBoundaries'][1]['sequence']=True
 if case=='wrong-options':cp['lastDurableCheckpoint']['observedRequestedOptions'][item['option']]=False
 if case=='future-offset':cp['stageBoundaries'][-1]['officialStartOffsetMs']=400000
 if case=='missing-runtime':x['officialReportRuntime']={}
 if case=='solve-throw-event':cp['stageBoundaries'].append({'sequence':3,'event':'solve_throw','phaseName':None,'solved':False,'failed':False,'officialStartOffsetMs':2});cp['rowCount']=4;cp['lastDurableCheckpoint'].update(sequence=3,event='solve_throw',officialStartOffsetMs=2)
 if case=='last-boundary-mismatch':cp['lastDurableCheckpoint'].update(event='step_throw',officialStartOffsetMs=-1)
 results.append({'case':case,'accepted':m.timeout_checkpoint_qualification(x)['sourceAndInputProvenByBoundedCheckpoints']})
print(json.dumps({'timeoutGuardProbe':results,'syntheticOnly':True}))

assert all(result["accepted"] is False for result in results), results
