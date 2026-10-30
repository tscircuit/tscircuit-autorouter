"""One synthetic relative-proof test; no actual retained inputs or checkers."""
import copy
import importlib.util
from pathlib import Path
import unittest

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('independent_stage_proof_controls',root/'replay-witness-relative-v4-main18-proof.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def fixture():
    def wire(x,y,layer):return {'route_type':'wire','x':x,'y':y,'width':.1,'layer':layer}
    raw=[{'type':'pcb_trace','pcb_trace_id':'traceA','connection_name':'A','route':[
        wire(-2,0,'inner1'),wire(-1,0,'inner1'),wire(0,0,'inner1'),
        {'route_type':'via','x':0,'y':0,'from_layer':'inner1','to_layer':'bottom','via_diameter':.3,'via_hole_diameter':.15},
        wire(0,0,'bottom'),wire(0,1,'bottom'),wire(0,2,'bottom')]},
        {'type':'pcb_trace','pcb_trace_id':'traceB','connection_name':'B','route':[wire(10,0,'top'),wire(10.3,0,'top'),wire(10.6,.2,'top'),wire(10.9,.2,'top'),wire(11.2,0,'top'),wire(11.5,0,'top')]}]
    original={'layerCount':4,'obstacles':[{'type':'rect','layers':['bottom'],'center':{'x':0,'y':2},'width':1,'height':3,'circuitJsonMetadata':{'pcb_smtpad_id':'padA'},'connectedTo':['A','endA']},
        {'type':'oval','layers':['top','inner1','inner2','bottom'],'center':{'x':20,'y':20},'width':1,'height':1,'circuitJsonMetadata':{'pcb_plated_hole_id':'unknownPTH'},'connectedTo':[]}],
        'connections':[{'name':'A','pointsToConnect':[{'x':-2,'y':0,'layer':'inner1','pcb_port_id':'startA'},{'x':0,'y':2,'layer':'bottom','pcb_port_id':'endA'}]},
        {'name':'B','pointsToConnect':[{'x':10,'y':0,'layer':'top','pcb_port_id':'startB'},{'x':11.5,'y':0,'layer':'top','pcb_port_id':'endB'}]}]}
    canonical=[{'type':'pcb_via','pcb_via_id':'viaA','pcb_trace_id':'traceA','x':0,'y':0,'outer_diameter':.3,'hole_diameter':.15,'layers':['top','inner1','inner2','bottom']},
        {'type':'pcb_trace','pcb_trace_id':'traceA','source_trace_id':'A','route':copy.deepcopy(raw[0]['route'])},
        {'type':'pcb_trace','pcb_trace_id':'traceB','source_trace_id':'B','route':copy.deepcopy(raw[1]['route'])},
        {'type':'pcb_smtpad','pcb_smtpad_id':'padA','x':0,'y':2,'shape':'rect','width':1,'height':3,'layer':'bottom'}]
    owners={'traceOwners':[{'originalId':'traceA','canonicalIndex':1,'status':'RESOLVED','owner':'ownerA'},{'originalId':'traceB','canonicalIndex':2,'status':'RESOLVED','owner':'ownerB'}],
        'viaOwners':[{'originalId':'viaA','canonicalIndex':0,'status':'RESOLVED','owner':'ownerA'}],
        'padOwners':[{'originalId':'padA','canonicalIndex':3,'status':'RESOLVED','owner':'ownerA'}]}
    before={'status':'UNKNOWN','reasons':['existing global open'],'circuitJson':canonical,'copper':owners}
    output=copy.deepcopy(raw);newcanonical=copy.deepcopy(canonical);moves=[]
    for kind,positions,dy in [('via',[(0,2),(0,3),(0,4)],.01),('wire',[(1,2),(1,3)],.005)]:
        occurrences=[]
        for ti,pi in positions:
            old=raw[ti]['route'][pi];new={'x':old['x'],'y':old['y']+dy};output[ti]['route'][pi].update(new);newcanonical[ti+1]['route'][pi].update(new)
            occurrences.append({'traceIndex':ti,'pointIndex':pi,'oldXY':{'x':old['x'],'y':old['y']},'newXY':new})
        moves.append({'kind':kind,'occurrences':occurrences})
    newcanonical[0]['y']=.01
    after={'status':'UNKNOWN','reasons':['existing global open'],'circuitJson':newcanonical,'copper':copy.deepcopy(owners)}
    trial={'stageSolveCalls':1,'routingExecutions':0,'accepted':False,'fullBoardRecovery':False,'qualityOrSpeedCredit':False,
        'before':{'fullCertificate':before},'after':{'fullCertificate':after},'localRepair':{'applied':True},
        'productionStage':{'solveCalls':1,'selectedMoves':moves,'relativeProof':{'status':'PASS'},'baselineCertificateMatchesIndependentBefore':True,'finalCertificateMatchesIndependentAfter':True}}
    return original,raw,output,canonical,trial


class RelativeProofReplayControls(unittest.TestCase):
    def test_real_stage_output_mask_and_unknown_material_relative_conditions(self):
        via_args=fixture()
        via_args[2][1]=copy.deepcopy(via_args[1][1])
        via_args[4]['after']['fullCertificate']['circuitJson'][2]=copy.deepcopy(via_args[3][2])
        via_args[4]['productionStage']['selectedMoves']=via_args[4]['productionStage']['selectedMoves'][:1]
        via_result=m.replay(*via_args)
        self.assertEqual(via_result['actualMovedRawPointCount'],3)
        self.assertEqual(len(via_result['mutableBundles']),1)
        self.assertEqual(len(via_result['mutableBundles'][0]['fixedBoundaries']),2)
        self.assertEqual(len(via_result['admittedFixedInterfaces']),3)
        self.assertTrue(via_result['sameOwnerOriginalTerminalPartitionsPreservedConditionally'])
        args=fixture();result=m.replay(*args)
        self.assertEqual(result['status'],'PASS_INDEPENDENT_RELATIVE_SAME_OWNER_ORIGINAL_TERMINAL_PARTITION_REPLAY')
        self.assertEqual(result['actualMovedRawPointCount'],5)
        self.assertEqual(result['originalPTHOuterEnvelopeCount'],1)
        self.assertEqual(len(result['admittedFixedInterfaces']),5)
        self.assertTrue(result['sameOwnerOriginalTerminalPartitionsPreservedConditionally'])
        self.assertFalse(result['accepted']);self.assertFalse(result['fullBoardRecovery'])
        mutations=[]
        def material(a):a[2][0]['route'][0]['width']=.2
        def metadata(a):a[2][1]['connection_name']='forged'
        def original_terminal(a):a[0]['connections'][1]['pointsToConnect'].append({'x':10.6,'y':.2,'layer':'top','pcb_port_id':'protected'})
        def unknown_pth(a):a[0]['obstacles'][1]['center']={'x':-.4,'y':0}
        def foreign_pad(a):a[4]['after']['fullCertificate']['copper']['padOwners'][0]['owner']='foreign'
        def unknown_owner(a):a[4]['after']['fullCertificate']['copper']['traceOwners'][0]['status']='UNKNOWN'
        def canonical_alias(a):a[4]['after']['fullCertificate']['circuitJson'][0]['y']=0
        def uncoupled(a):a[4]['productionStage']['selectedMoves'][0]['occurrences'].pop();a[2][0]['route'][4]=copy.deepcopy(a[1][0]['route'][4]);a[4]['after']['fullCertificate']['circuitJson'][1]['route'][4]=copy.deepcopy(a[1][0]['route'][4])
        def via_cap(a):a[4]['productionStage']['selectedMoves'][0]['occurrences'][0]['newXY']['y']=.251
        def wire_cap(a):a[4]['productionStage']['selectedMoves'][1]['occurrences'][0]['newXY']['y']=.231
        def no_solve(a):a[4]['productionStage']['solveCalls']=0
        def accepted(a):a[4]['accepted']=True
        def mixed_hole(a):a[0]['obstacles'][0]['isNonPlatedHole']=True
        def mixed_pour(a):a[0]['obstacles'][0]['isCopperPour']=True
        def mixed_pth(a):a[0]['obstacles'][0]['circuitJsonMetadata']['pcb_plated_hole_id']='forged'
        def non_solid(a):a[0]['obstacles'][0]['shape']='oval'
        def extra_landing(a):
            route=[{'route_type':'wire','x':x,'y':0,'width':.1,'layer':'inner1'}for x in [-.2,0,.2]]
            a[1].append({'type':'pcb_trace','pcb_trace_id':'extraLanding','connection_name':'A','route':copy.deepcopy(route)})
            out=copy.deepcopy(a[1][-1]);out['route'][1]['y']=.01;a[2].append(out)
            a[3].append({'type':'pcb_trace','pcb_trace_id':'extraLanding','source_trace_id':'A','route':copy.deepcopy(route)})
            after=copy.deepcopy(a[3][-1]);after['route'][1]['y']=.01;a[4]['after']['fullCertificate']['circuitJson'].append(after)
            for key in ['before','after']:a[4][key]['fullCertificate']['copper']['traceOwners'].append({'originalId':'extraLanding','canonicalIndex':4,'status':'RESOLVED','owner':'ownerA'})
            a[4]['productionStage']['selectedMoves'][0]['occurrences'].append({'traceIndex':2,'pointIndex':1,'oldXY':{'x':0,'y':0},'newXY':{'x':0,'y':.01}})
        for mutate in [material,metadata,original_terminal,unknown_pth,foreign_pad,unknown_owner,canonical_alias,uncoupled,via_cap,wire_cap,no_solve,accepted,mixed_hole,mixed_pour,mixed_pth,non_solid]:
            bad=copy.deepcopy(fixture());mutate(bad)
            with self.assertRaises((ValueError,AssertionError)):m.replay(*bad)
        bad=copy.deepcopy(fixture());extra_landing(bad)
        with self.assertRaisesRegex(ValueError,'Fixed wire geometry changed outside derived mutable bundles'):m.replay(*bad)


if __name__=='__main__':unittest.main()
