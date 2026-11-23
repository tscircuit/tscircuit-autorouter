import { createHash } from "node:crypto"
import assert from "node:assert/strict"
import { isDeepStrictEqual } from "node:util"
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { FanoutSolver } from "../../core/node_modules/@tscircuit/fanout-solver/lib/fanout-solver"
import { validateRoutedCopperDrc } from "../../core/node_modules/@tscircuit/fanout-solver/lib/validate-routed-copper-drc"
import { distance, distancePointToObstacle } from "../../core/node_modules/@tscircuit/fanout-solver/lib/geometry"
import { getPlanVias } from "../../core/node_modules/@tscircuit/fanout-solver/lib/route-bus/plan-copper"
import { visualizeSimpleRouteJson } from "../../core/node_modules/@tscircuit/fanout-solver/lib/visualize-simple-route-json"
import { getSvgFromGraphicsObject } from "../../core/node_modules/graphics-debug"
import { connectionsShareElectricalNet } from "../../core/node_modules/@tscircuit/fanout-solver/lib/net-identity"
import { validateFanoutSolution } from "../../core/node_modules/@tscircuit/fanout-solver/lib/validate-fanout-solution"
import { getFullConnectivityMapFromCircuitJson } from "../../core/node_modules/circuit-json-to-connectivity-map"
const samples = ["butterstick-original","butterstick-spaced","glider-original","glider-spaced","h616-original","h616-spaced","icepi-original","icepi-spaced","imx6-original","imx6-spaced"]
const json = (path: string) => JSON.parse(path.endsWith(".gz") ? gunzipSync(readFileSync(path)).toString() : readFileSync(path,"utf8"))
const comparison = process.argv[2]
assert(comparison==="main","Specify the main control")
const out = "audited-results/"+comparison
mkdirSync(out,{recursive:true})
const rows=[]
for (const sample of samples) {
  const directories = [comparison,"after"].map(mode => join(mode, "full-circuit-interception-"+sample, sample))
  const captures = directories.map(folder => {
    const report=json(join(folder,"report.json"))
    const entry=report.solvers.find(s=>s.name==="FanoutSolver")
    const args=json(join(folder,"solver-"+entry.id+"-input.json.gz"))
    const state=json(join(folder,"solver-"+entry.id+"-state.json.gz"))
    const solver=new FanoutSolver(args[0],args[1])
    const best=state.bestAttempt
    assert(best,"Missing best attempt: "+sample)
    const drc=validateRoutedCopperDrc({inputSrj:args[0],routedSrj:best.outputSrj,clearance:solver.config.clearance,allowBlindAndBuriedVias:solver.config.allowBlindAndBuriedVias})
    assert(drc.valid, sample+" native copper DRC failed")
    const viaInPad=[]
    for (const plan of best.plans) {
      for (const via of getPlanVias(plan)) {
        for (const pad of args[0].obstacles) {
          if(pad.isCopperPour || !pad.layers.some(layer=>via.spanLayers.includes(layer)))continue
          if(distancePointToObstacle(via.center,pad) < via.diameter/2-1e-9)viaInPad.push({connection:plan.connectionName,via:via.center,pad:pad.center})
        }
      }
    }
    assert.equal(viaInPad.length,0,sample+" physical via-in-pad")
    const vias=best.plans.flatMap(p=>getPlanVias(p))
    let drillViolations=0,viaPadClearanceViolations=0
    const drillGap=Math.max(args[0].minViaHoleEdgeToViaHoleEdgeClearance??0,args[0].minPlatedHoleDrillEdgeToDrillEdgeClearance??0)
    for(let i=0;i<vias.length;i++)for(let j=i+1;j<vias.length;j++) {
      if(vias[i].spanLayers.some(l=>vias[j].spanLayers.includes(l))&&distance(vias[i].center,vias[j].center)<(vias[i].holeDiameter+vias[j].holeDiameter)/2+drillGap-1e-9)drillViolations++
    }
    for(const via of vias)for(const pad of args[0].obstacles) {
      if(!pad.isCopperPour&&pad.layers.some(l=>via.spanLayers.includes(l))&&distancePointToObstacle(via.center,pad)<via.diameter/2+solver.config.clearance-1e-9)viaPadClearanceViolations++
    }
    assert.equal(drillViolations,0,sample+" drilled-hole clearance")
    assert.equal(viaPadClearanceViolations,0,sample+" via-to-pad clearance")
    const circuit=json(join(folder,"circuit.json.gz"))
    const connectivity=getFullConnectivityMapFromCircuitJson(circuit)
    const pcbPorts=new Map(circuit.filter(e=>e.type==="pcb_port").map(e=>[e.pcb_port_id,e]))
    const sourcePortForPlan=p=>pcbPorts.get(p.sourcePoint.pcb_port_id??p.sourcePoint.pointId)?.source_port_id
    let aliasMismatches=0,unknownPorts=0
    for(const p of best.plans) {const port=sourcePortForPlan(p);if(!port||!connectivity.getNetConnectedToId(port))unknownPorts++}
    for(let i=0;i<best.plans.length;i++)for(let j=i+1;j<best.plans.length;j++) {
      const first=best.plans[i],second=best.plans[j],a=sourcePortForPlan(first),b=sourcePortForPlan(second)
      if(a&&b&&connectionsShareElectricalNet(args[0],first.connectionName,second.connectionName)&&!connectivity.areIdsConnected(a,b))aliasMismatches++
    }
    assert.equal(aliasMismatches,0,sample+" original circuit net mismatch")
    assert.equal(unknownPorts,0,sample+" unknown source ports")
    const structure=validateFanoutSolution({inputSrj:args[0],outputSrj:best.outputSrj,plans:best.plans,preparedBuses:solver.preparedBuses,sharedBoundary:args[1].sharedBoundary,clearance:solver.config.clearance,allowBlindAndBuriedVias:solver.config.allowBlindAndBuriedVias})
    const structuralIssues=structure.issues.filter(i=>i.code!=="missing-plan")
    const assessment=json(join(folder,"assessment.json"))
    assert.equal(assessment.membershipErrors.length,0,sample+" original circuit membership")
    assert.equal(assessment.components,assessment.expectedComponents)
    assert.equal(assessment.pads,assessment.expectedPads)
    const groups=new Map<string,number>()
    for(const plan of best.plans)groups.set(plan.busId,(groups.get(plan.busId)??0)+1)
    for(const bus of state.preparedBuses) {
      const count=groups.get(bus.busId)??0
      assert(count===0 || count===bus.connections.length,sample+" partial bus "+bus.busId)
      const routed=best.plans.filter(p=>p.busId===bus.busId)
      assert(new Set(routed.map(p=>p.targetLayer)).size<=1,sample+" split bus layers")
      assert(new Set(routed.map(p=>p.direction)).size<=1,sample+" split bus directions")
      assert(new Set(routed.map(p=>Boolean(p.via))).size<=1,sample+" partial bus via use")
    }
    return {report,args,state,best,drc,viaInPad,folder,drillViolations,viaPadClearanceViolations,aliasMismatches,unknownPorts,assessment,structuralIssues}
  })
  const [before,after]=captures
  assert(isDeepStrictEqual(before.args,after.args),sample+" fanout constructor inputs changed")
  const originalCircuits=captures.map(c=>json(join(c.folder,"circuit.json.gz")).filter(e=>["pcb_component","pcb_smtpad","pcb_plated_hole","pcb_port","source_component","source_port","source_net","source_trace","source_component_internal_connection"].includes(e.type)))
  assert(isDeepStrictEqual(originalCircuits[0],originalCircuits[1]),sample+" original geometry/net membership changed")
  const beforeSet=new Set<string>(before.best.plans.map(p=>p.connectionName))
  const afterSet=new Set<string>(after.best.plans.map(p=>p.connectionName))
  const gained=[...afterSet].filter(n=>!beforeSet.has(n)).sort()
  const lost=[...beforeSet].filter(n=>!afterSet.has(n)).sort()
  const commonCount=Math.min(before.state.attempts.length,after.state.attempts.length)
  const layerSignature=a=>JSON.stringify(Object.entries(a.busLayerAssignments).sort())
  const sameAssignmentPrefix=before.state.attempts.slice(0,commonCount).every((a,i)=>layerSignature(a)===layerSignature(after.state.attempts[i]))
  const commonPrefixBest=sameAssignmentPrefix ? captures.map(c=>Math.max(...c.state.attempts.slice(0,commonCount).map(a=>a.routedConnectionCount))) : null
  const scores=captures.map(c=>{
    const byAssignment=new Map<string,number>()
    for(const attempt of c.state.attempts){const key=layerSignature(attempt);byAssignment.set(key,Math.max(byAssignment.get(key)??0,attempt.routedConnectionCount))}
    return byAssignment
  })
  const commonAssignments=[...scores[0].keys()].filter(key=>scores[1].has(key))
  const commonAssignmentBest=commonAssignments.length ? scores.map(score=>Math.max(...commonAssignments.map(key=>score.get(key)!))) : null
  const retained=before.best.plans.filter(p=>after.best.plans.some(q=>q.connectionName===p.connectionName&&isDeepStrictEqual(p,q))).length
  const beforeGeometry=new Set(before.structuralIssues.map(i=>JSON.stringify(i)))
  const newStructuralIssues=after.structuralIssues.filter(i=>!beforeGeometry.has(JSON.stringify(i)))
  assert.equal(newStructuralIssues.length,0,sample+" introduced endpoint/route issues: "+JSON.stringify(newStructuralIssues))
  const pcbEqual=readFileSync(join(before.folder,"pcb.svg")).equals(readFileSync(join(after.folder,"pcb.svg")))
  const summary={
    sample,requested:before.args[0].connections.length,
    before:before.best.plans.length,after:after.best.plans.length,
    planes:captures.map(c=>c.best.plans.filter(p=>p.termination.type==="plane").length),
    vias:captures.map(c=>c.drc.checkedViaCount),
    assignments:captures.map(c=>c.state.attempts.length),
    gained,lost,retainedOriginalPlans:retained,inputsEqual:true,circuitGeometryAndNetsEqual:true,pcbSvgEqual:pcbEqual,
    commonCompletedAssignmentCount:commonCount,sameAssignmentPrefix,commonPrefixBest,commonAssignmentCount:commonAssignments.length,commonAssignmentBest,
    independentDrillViolations:captures.map(c=>c.drillViolations),independentViaPadClearanceViolations:captures.map(c=>c.viaPadClearanceViolations),
    sourceNetMismatchPairs:captures.map(c=>c.aliasMismatches),unknownSourcePorts:captures.map(c=>c.unknownPorts),
    structuralIssues:captures.map(c=>c.structuralIssues),
    circuitComponents:captures.map(c=>c.assessment.components),circuitPads:captures.map(c=>c.assessment.pads),membershipErrors:captures.map(c=>c.assessment.membershipErrors),
    connectedFullBoardNets:captures.map(c=>c.assessment.connectedNets),requestedFullBoardNets:before.assessment.requestedNets,
    committedBoardVias:captures.map(c=>c.assessment.vias),committedBoardTraceLength:captures.map(c=>c.assessment.wireLengthMm),
    pcbSha256:captures.map(c=>createHash("sha256").update(readFileSync(join(c.folder,"pcb.svg"))).digest("hex")),
    nativeDrc:captures.map(c=>c.drc.valid),physicalViaInPad:captures.map(c=>c.viaInPad.length),
    fanoutSolved:captures.map(c=>c.state.solved),fullCircuitStatus:captures.map(c=>c.report.status),
    sameCompletedOutput:isDeepStrictEqual(before.best.outputSrj,after.best.outputSrj),
    wireLengthMm:captures.map(c=>c.best.plans.reduce((sum,p)=>sum+p.length,0)),
    rejectionCounts:captures.map(c=>{
      const counts={}
      for(const r of json(join(c.folder,"pipeline-internals.json")).rejections)counts[r.reason]=(counts[r.reason]??0)+r.count
      return counts
    }),
    windingFailures:captures.map(c=>c.report.solvers.filter(s=>s.name==="WindingBreakoutSolver"&&s.failed).map(s=>s.error))
  }
  rows.push(summary)
  {
    for(let index=0;index<captures.length;index++) {
      const capture=captures[index]
      const side=index===0?"before":"after"
      const pcbDirectory=join(out,"full-boards",side)
      mkdirSync(pcbDirectory,{recursive:true})
      copyFileSync(join(capture.folder,"pcb.svg"),join(pcbDirectory,sample+".svg"))
      const mode=index===0?"before":"after"
      const boundary=capture.args[1].sharedBoundary
      const halo=.5
      const obstacles=capture.args[0].obstacles.filter(o=>!o.isCopperPour && o.center.x+o.width/2>=boundary.minX-halo && o.center.x-o.width/2<=boundary.maxX+halo && o.center.y+o.height/2>=boundary.minY-halo && o.center.y-o.height/2<=boundary.maxY+halo)
      const graphics=visualizeSimpleRouteJson({...capture.best.outputSrj,obstacles,bounds:boundary,connections:[]})
      graphics.texts=[{x:boundary.minX,y:boundary.maxY+1,text:sample+": "+capture.best.plans.length+"/"+capture.args[0].connections.length+" partial fanout escapes; "+capture.drc.checkedViaCount+" vias",fontSize:.3,color:"#0f172a",anchorSide:"center_left"}]
      writeFileSync(join(out,sample+"-"+mode+".svg"),getSvgFromGraphicsObject(graphics,{backgroundColor:"white",svgWidth:1000,svgHeight:1000}))
    }
  }
  console.log("AUDIT_CASE",comparison,JSON.stringify(summary))
}
assert.equal(rows.length,10)
writeFileSync(join(out,"statistics.json"),JSON.stringify(rows,null,2)+"\n")
console.log("AUDIT_TOTALS",comparison,JSON.stringify({before:rows.reduce((s,r)=>s+r.before,0),after:rows.reduce((s,r)=>s+r.after,0),gained:rows.reduce((s,r)=>s+r.gained.length,0),lost:rows.reduce((s,r)=>s+r.lost.length,0),fullBoards:rows.filter(r=>r.fullCircuitStatus[1]==="complete").length,requested:rows.reduce((s,r)=>s+r.requested,0)}))
