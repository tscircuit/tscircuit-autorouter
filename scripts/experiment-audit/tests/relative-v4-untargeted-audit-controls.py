"""One independent full-record JSON audit control; no source checker or board."""
import copy,importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location('untargeted_data_audit',ROOT/'relative-v4-untargeted-audit.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def fixture():
    known={'finding':{'routeIndex':2,'obstacleIndex':0,'kind':'wire','severity':0.000005},'route':{'connectionName':'owner-a','route':[{'x':1,'y':2,'z':0},{'x':3,'y':2,'z':0}]},'raw':{'traceIndex':4,'pointIndex':7,'owner':{'status':'RESOLVED','owner':'owner-a'},'rawSegment':[{'x':1,'y':2},{'x':3,'y':2}]},'originalObstacleIndex':0,'originalObstacle':{'type':'rect','center':{'x':2,'y':3},'width':1,'height':1,'layers':['top'],'connectedTo':['owner-b']},'originalObstacleOwner':{'status':'RESOLVED','owner':'owner-b'}}
    unknown=copy.deepcopy(known);unknown.update(finding={'routeIndex':3,'obstacleIndex':1,'kind':'via','severity':0.03375},raw={'owner':'owner-c','x':-1,'y':-2,'diameter':0.3,'drill':0.15,'layers':['top','bottom']},originalObstacleIndex=1,originalObstacle={'type':'rect','center':{'x':-1,'y':-2},'width':1,'height':1,'layers':['top','bottom'],'connectedTo':[]},originalObstacleOwner={'status':'UNKNOWN','reason':'No declared original owner'})
    details={key:[]for key in m.DETAIL_FIELDS};details.update(srjObstacles=[known,unknown],viaPadPolicy=[copy.deepcopy(unknown)])
    target={'checkClass':'viaTrace','classification':'DECLARED_FOREIGN_COPPER','owners':[{'type':'pcb_via','id':'opaque:via','status':'RESOLVED','owner':'owner-x'},{'type':'pcb_trace','id':'opaque:trace','status':'RESOLVED','owner':'owner-y'}],'error':{'actual_clearance':0.06,'minimum_clearance':0.1}}
    before={'status':'UNKNOWN','reasons':['Existing unchanged reason'],'demandsChecked':4,'referenceErrorCount':0,'srjObstacleViolationCount':2,'viaPadPolicyViolationCount':1,'viaInPadViolationCount':0,'copper':{'ownershipCoverageStatus':'COMPLETE','allPublishedCopperChecksRun':True,'allFindings':[target],'checksRun':sorted(m.CHECKS),'checks':{name:{'count':int(name=='viaTrace'),'findings':[target]if name=='viaTrace'else[]}for name in m.CHECKS}}}
    after=copy.deepcopy(before);after['copper']['allFindings']=[];after['copper']['checks']['viaTrace']={'count':0,'findings':[]}
    q={'status':'LOCAL_REPAIRED','localRepaired':True,'accepted':False,'initialFullCertificateStatus':'UNKNOWN','finalFullCertificateStatus':'UNKNOWN','relativeStatus':'PASS','proposals':1,'beforeGeometryFindings':4,'afterGeometryFindings':3,'protectedUnchanged':True}
    stage={'className':'Pipeline9RelativeWitnessRepairSolver','solveCalls':1,'solved':True,'failed':False,'error':None,'qualification':q,'stats':{'acceptanceMode':'EXACT_UNTARGETED_FINDINGS','targetFindingCountBefore':1,'targetFindingCountAfter':0,'untargetedFindingsPreserved':True},'relativeProof':{'status':'PASS'},'findingPreservation':{'status':'PASS','reason':'Exact complete records'},'baselineGeometryDetailsMatchIndependent':True,'finalGeometryDetailsMatchIndependent':True,'baselineCertificateMatchesIndependentBefore':True,'finalCertificateMatchesIndependentAfter':True,'baselineGeometryDetails':copy.deepcopy(details),'finalGeometryDetails':copy.deepcopy(details)}
    return {'before':{'fullCertificate':before},'after':{'fullCertificate':after},'independentGeometryDetailsBefore':copy.deepcopy(details),'independentGeometryDetailsAfter':copy.deepcopy(details),'productionStage':stage,'localRepair':{'applied':True,'acceptanceMode':'EXACT_UNTARGETED_FINDINGS','strictTargetRemoved':True,'untargetedDetailsExact':True,'globalScopeExact':True,'rawMaskPassed':True,'canonicalProtectedMaskPassed':True,'differences':[{'traceIndex':1,'pointIndex':3}],'beforeGeometryFindingCount':4,'afterGeometryFindingCount':3},'routingExecutions':0,'stageSolveCalls':1,'accepted':False,'fullBoardRecovery':False,'qualityOrSpeedCredit':False}
def main():
    checks=[]
    def test(name,condition):assert condition,name;checks.append(name)
    def reject(name,mutate):
        value=fixture();mutate(value)
        try:m.audit(value)
        except(ValueError,KeyError,TypeError):checks.append(name);return
        raise AssertionError('Forged detail accepted: '+name)
    value=fixture();result=m.audit(value);test('exact-full-record-local-target-repair-with-anonymous-fixed-unknown',result['status']=='PASS_EXACT_UNTARGETED_FINDING_PRESERVATION'and result['anonymousUnknownHardObstacleRecordsPreserved']==2 and result['beforeGeometryFindingCount']==4 and result['afterGeometryFindingCount']==3 and result['globalAcceptance']is False)
    value=fixture();value['independentGeometryDetailsAfter']['srjObstacles'].reverse();value['productionStage']['finalGeometryDetails']=copy.deepcopy(value['independentGeometryDetailsAfter']);test('full-multiset-reordering-preserves-records',m.audit(value)['status'].startswith('PASS_'))
    value=fixture()
    for side in['Before','After']:
        value['independentGeometryDetails'+side]['srjObstacles'].append(copy.deepcopy(value['independentGeometryDetails'+side]['srjObstacles'][0]))
        value['productionStage'][('baseline'if side=='Before'else'final')+'GeometryDetails']=copy.deepcopy(value['independentGeometryDetails'+side])
    for side in['before','after']:value[side]['fullCertificate']['srjObstacleViolationCount']=3
    test('duplicate-findings-retained-with-multiplicity',m.audit(value)['status'].startswith('PASS_'))
    for key,bad in[('originalObstacleIndex',9),('originalObstacleOwner',{'status':'RESOLVED','owner':'invented'}),('raw',{'traceIndex':99}),('route',{'connectionName':'swapped'}),('finding',{'routeIndex':2,'obstacleIndex':0,'kind':'wire','severity':0.000006})]:
        reject('same-count-'+key+'-swap',lambda v,key=key,bad=bad:v['independentGeometryDetailsAfter']['srjObstacles'][0].update({key:bad}))
    for key in m.DETAIL_FIELDS:
        reject('missing-complete-collection-'+key,lambda v,key=key:v['independentGeometryDetailsAfter'].pop(key))
    reject('duplicate-lost-even-with-count-refreshed',lambda v:(v['independentGeometryDetailsAfter']['srjObstacles'].pop(),v['after']['fullCertificate'].update(srjObstacleViolationCount=1)))
    for field,bad in[('status','PASS'),('reasons',['changed']),('demandsChecked',5),('referenceErrorCount',1),('viaPadPolicyViolationCount',0)]:reject('global-'+field,lambda v,field=field,bad=bad:v['after']['fullCertificate'].update({field:bad}))
    for key in['nativeErrors','nativeErrorsWithCenters','nativeLocationAwareErrors','viaInPad','boardReasons']:reject('new-untargeted-'+key,lambda v,key=key:v['independentGeometryDetailsAfter'][key].append({'new':'finding'}))
    for key in['baselineGeometryDetails','finalGeometryDetails']:reject('source-snapshot-'+key,lambda v,key=key:v['productionStage'][key]['nativeErrors'].append({'source':'only'}))
    for flag in['accepted','fullBoardRecovery','qualityOrSpeedCredit']:reject('no-global-claim-'+flag,lambda v,flag=flag:v.update({flag:True}))
    for bad in[float('nan'),float('inf'),object()]:reject('non-json-lossless-value-'+type(bad).__name__,lambda v,bad=bad:v['independentGeometryDetailsAfter']['srjObstacles'][0]['finding'].update(severity=bad))
    reject('native-check-population-omitted',lambda v:v['after']['fullCertificate']['copper']['checks'].pop('padPad'))
    reject('strict-target-retained',lambda v:v['after']['fullCertificate'].update(copper=copy.deepcopy(v['before']['fullCertificate']['copper'])))
    reject('source-target-count-bool-not-int',lambda v:v['productionStage']['stats'].update(targetFindingCountBefore=True))
    reject('anonymous-obstacle-gains-identity',lambda v:v['independentGeometryDetailsAfter']['viaPadPolicy'][0]['originalObstacle'].update(circuitJsonMetadata={'pcb_smtpad_id':'invented'}))
    reject('anonymous-obstacle-gains-owner',lambda v:v['independentGeometryDetailsAfter']['viaPadPolicy'][0]['originalObstacle'].update(connectedTo=['owner']))
    reject('anonymous-unknown-reason-changed',lambda v:v['independentGeometryDetailsAfter']['viaPadPolicy'][0]['originalObstacleOwner'].update(reason='another'))
    value=fixture();value['after']=copy.deepcopy(value['before']);value['localRepair'].update(applied=False,differences=[]);test('negative-result-preserves-complete-certificate-no-positive-gate',m.audit(value)['status']=='NO_LOCAL_REPAIR_OUTPUT_UNCHANGED')
    reject('claimed-noop-with-changed-complete-certificate',lambda v:v['localRepair'].update(applied=False,differences=[]))
    print(json.dumps({'status':'PASS_DATA_ONLY_COMPLETE_UNTARGETED_FINDING_AUDIT','count':len(checks),'checks':checks,'realBoards':0,'checkerExecutions':0}))
if __name__=='__main__':main()
