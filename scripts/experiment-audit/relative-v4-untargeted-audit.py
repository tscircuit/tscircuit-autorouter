"""Data-only audit of complete retained predicate records; invokes no checker."""
import hashlib,json,math
DETAIL_FIELDS={'nativeErrors','nativeErrorsWithCenters','nativeLocationAwareErrors','viaInPad','srjObstacles','viaPadPolicy','boardReasons'}
CHECKS={'viaPad','padTrace','viaTrace','traceOverlap','differentNetViaSpacing','sameNetViaSpacing','padPad'}
def require(condition,message):
    if not condition:raise ValueError(message)
def canonical(value):
    def validate(item):
        if item is None or type(item)in[bool,str,int]:return
        if type(item)is float:
            require(math.isfinite(item),'Nonfinite retained detail number');return
        if type(item)is list:
            for entry in item:validate(entry)
            return
        require(type(item)is dict and all(type(key)is str for key in item),'Non-JSON retained detail')
        for entry in item.values():validate(entry)
    validate(value)
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)
def bag(values):
    require(type(values)is list,'Every complete predicate collection must be an array')
    return sorted(canonical(value)for value in values)
def same(a,b):return canonical(a)==canonical(b)
def integer(value):return type(value)is int and value>=0
def detail_records(details,certificate):
    require(type(details)is dict and set(details)==DETAIL_FIELDS,'Missing or extra complete predicate collection')
    for values in details.values():bag(values)
    for key,field in [('nativeErrors','referenceErrorCount'),('viaInPad','viaInPadViolationCount'),('srjObstacles','srjObstacleViolationCount'),('viaPadPolicy','viaPadPolicyViolationCount')]:
        require(integer(certificate.get(field))and len(details[key])==certificate[field],'Detailed predicate count differs from full certificate: '+key)
    unknown=0
    for key in['srjObstacles','viaPadPolicy']:
        for row in details[key]:
            require(type(row)is dict and set(row)=={'finding','route','raw','originalObstacleIndex','originalObstacle','originalObstacleOwner'},'Incomplete finding identity/geometry binding')
            finding,owner,obstacle=row['finding'],row['originalObstacleOwner'],row['originalObstacle']
            require(type(finding)is dict and type(row['route'])is dict and type(row['raw'])is dict and type(obstacle)is dict and type(owner)is dict,'Missing complete physical finding record')
            require(integer(row['originalObstacleIndex'])and finding.get('obstacleIndex')==row['originalObstacleIndex']and type(finding.get('obstacleIndex'))is int,'Original obstacle index binding mismatch')
            require(integer(finding.get('routeIndex')),'Missing predicate route identity')
            require(owner.get('status')in['RESOLVED','UNKNOWN'],'Missing explicit original obstacle ownership state')
            if owner['status']=='UNKNOWN':
                require(type(owner.get('reason'))is str and bool(owner['reason']),'Anonymous obstacle must retain its explicit UNKNOWN reason')
                require(obstacle.get('connectedTo')==[]and type(obstacle.get('connectedTo'))is list and obstacle.get('circuitJsonMetadata')in[None,{}],'Unresolved conductive identity is outside anonymous hard-obstacle scope')
                require(obstacle.get('type')=='rect'and type(obstacle.get('center'))is dict,'Anonymous fixed obstacle lacks supported footprint')
                for value in[obstacle.get('width'),obstacle.get('height')]:require(type(value)in[int,float]and math.isfinite(value)and value>0,'Anonymous fixed obstacle dimensions invalid')
                for value in[obstacle['center'].get('x'),obstacle['center'].get('y'),obstacle.get('ccwRotationDegrees',0)]:require(type(value)in[int,float]and math.isfinite(value),'Anonymous fixed obstacle geometry invalid')
                require(type(obstacle.get('layers'))is list and len(obstacle['layers'])>0 and all(type(layer)is str and layer for layer in obstacle['layers'])and len(set(obstacle['layers']))==len(obstacle['layers']),'Anonymous fixed obstacle layer binding invalid')
                unknown+=1
    return unknown
def strict_findings(certificate,expected):
    copper=certificate.get('copper')
    require(type(copper)is dict and copper.get('ownershipCoverageStatus')=='COMPLETE'and copper.get('allPublishedCopperChecksRun')is True,'All original-owner copper predicates must have complete coverage')
    values=copper.get('allFindings');require(type(values)is list and len(values)==expected,'Wrong strict target population')
    checks,run=copper.get('checks'),copper.get('checksRun')
    require(type(checks)is dict and set(checks)==CHECKS and type(run)is list and len(run)==7 and set(run)==CHECKS,'Incomplete seven-predicate population')
    complete=[]
    for name,record in checks.items():
        require(type(record)is dict and integer(record.get('count'))and type(record.get('findings'))is list and record['count']==len(record['findings'])and all(type(f)is dict and f.get('checkClass')==name for f in record['findings']),'Per-predicate full finding population differs')
        complete.extend(record['findings'])
    require(bag(complete)==bag(values),'Complete strict findings differ from per-predicate records')
    if expected:
        finding=values[0];require(type(finding)is dict and finding.get('checkClass')=='viaTrace'and finding.get('classification')=='DECLARED_FOREIGN_COPPER','The sole removed target must be the declared-foreign viaTrace witness')
def audit(trial):
    require(type(trial)is dict,'Missing retained production trial')
    for field in['accepted','fullBoardRecovery','qualityOrSpeedCredit']:require(trial.get(field)is False,'Local preservation cannot claim global acceptance')
    require(trial.get('routingExecutions')==0 and type(trial.get('routingExecutions'))is int and trial.get('stageSolveCalls')==1 and type(trial.get('stageSolveCalls'))is int,'Exactly one retained stage and no routing required')
    before=trial.get('before',{}).get('fullCertificate');after=trial.get('after',{}).get('fullCertificate');require(type(before)is dict and type(after)is dict,'Complete old-body certificates required')
    db,da=trial.get('independentGeometryDetailsBefore'),trial.get('independentGeometryDetailsAfter');ub,ua=detail_records(db,before),detail_records(da,after);comparisons=[]
    for key in sorted(DETAIL_FIELDS):
        old,new=bag(db[key]),bag(da[key]);require(old==new,'An untargeted complete finding changed: '+key)
        comparisons.append({'predicate':key,'records':len(old),'multisetSha256':hashlib.sha256(canonical(old).encode()).hexdigest()})
    require(ub==ua,'Anonymous hard-obstacle finding multiplicity changed')
    require(db['boardReasons']==[]and da['boardReasons']==[],'Complete board-envelope screens must remain clean')
    for key in['status','reasons','demandsChecked','referenceErrorCount','srjObstacleViolationCount','viaPadPolicyViolationCount','viaInPadViolationCount']:
        require(key in before and key in after and same(before[key],after[key]),'Global certificate scope/untargeted counts changed: '+key)
    require(before['status']==after['status']=='UNKNOWN'and type(before['reasons'])is list and integer(before['demandsChecked'])and before['referenceErrorCount']==0,'Retained global UNKNOWN and reference coverage must remain explicit')
    local=trial.get('localRepair');stage=trial.get('productionStage');require(type(local)is dict and type(stage)is dict and type(local.get('applied'))is bool,'Missing explicit stage/local result')
    require(stage.get('className')=='Pipeline9RelativeWitnessRepairSolver'and stage.get('solveCalls')==1 and stage.get('solved')is True and stage.get('failed')is False and stage.get('error')is None,'Actual production stage did not complete normally')
    require(stage.get('baselineCertificateMatchesIndependentBefore')is True and stage.get('finalCertificateMatchesIndependentAfter')is True,'Each source certificate must match independent old-body evaluation at its own geometry')
    strict_findings(before,1)
    if not local['applied']:
        require(local.get('differences')==[]and same(before,after),'Negative local result must preserve complete output certificate');strict_findings(after,1)
        return {'status':'NO_LOCAL_REPAIR_OUTPUT_UNCHANGED','fullCertificateStatus':'UNKNOWN','completeUntargetedCollections':comparisons,'localRepair':False,'positiveGate':False,'qualityOrSpeedCredit':False}
    strict_findings(after,0)
    for field in['strictTargetRemoved','untargetedDetailsExact','globalScopeExact','rawMaskPassed','canonicalProtectedMaskPassed']:require(local.get(field)is True,'Missing independent local invariant: '+field)
    require(local.get('acceptanceMode')=='EXACT_UNTARGETED_FINDINGS'and type(local.get('differences'))is list and len(local['differences'])>0,'Wrong incremental mode or empty mutation')
    require(integer(local.get('beforeGeometryFindingCount'))and integer(local.get('afterGeometryFindingCount'))and local['beforeGeometryFindingCount']==local['afterGeometryFindingCount']+1,'Exactly the strict target finding must be removed')
    q,t=stage.get('qualification'),stage.get('stats');require(type(q)is dict and type(t)is dict,'Missing complete source qualification/counters')
    require(q.get('status')=='LOCAL_REPAIRED'and q.get('localRepaired')is True and q.get('accepted')is False and q.get('relativeStatus')=='PASS'and q.get('protectedUnchanged')is True,'Source local/contact qualification incomplete')
    require(q.get('beforeGeometryFindings')==local['beforeGeometryFindingCount']and q.get('afterGeometryFindings')==local['afterGeometryFindingCount'],'Source geometry counters differ from independent target change')
    require(q.get('initialFullCertificateStatus')==q.get('finalFullCertificateStatus')=='UNKNOWN','Local source qualification cannot promote full UNKNOWN')
    require(t.get('acceptanceMode')=='EXACT_UNTARGETED_FINDINGS'and t.get('targetFindingCountBefore')==1 and type(t.get('targetFindingCountBefore'))is int and t.get('targetFindingCountAfter')==0 and type(t.get('targetFindingCountAfter'))is int and t.get('untargetedFindingsPreserved')is True,'Source incremental acceptance counters incomplete')
    require(type(stage.get('findingPreservation'))is dict and stage['findingPreservation'].get('status')=='PASS'and type(stage['findingPreservation'].get('reason'))is str,'Source finding preservation missing')
    require(type(stage.get('relativeProof'))is dict and stage['relativeProof'].get('status')=='PASS','Source relative contact proof missing')
    for label,details in[('baseline',db),('final',da)]:
        require(stage.get(label+'GeometryDetailsMatchIndependent')is True and same(stage.get(label+'GeometryDetails'),details),'Source detail snapshot differs from independent same-geometry old-body records: '+label)
    return {'status':'PASS_EXACT_UNTARGETED_FINDING_PRESERVATION','completeUntargetedCollections':comparisons,'anonymousUnknownHardObstacleRecordsPreserved':ub,'strictViaTraceBefore':1,'strictViaTraceAfter':0,'beforeGeometryFindingCount':local['beforeGeometryFindingCount'],'afterGeometryFindingCount':local['afterGeometryFindingCount'],'globalCertificateStatus':'UNKNOWN','globalDemandCount':before['demandsChecked'],'globalReasonCount':len(before['reasons']),'sourceDetailsMatchIndependentOldBodyRecords':True,'relativeContactAndLiteralTargetClearanceNeedCompanionReplay':True,'globalAcceptance':False,'qualityOrSpeedCredit':False}
