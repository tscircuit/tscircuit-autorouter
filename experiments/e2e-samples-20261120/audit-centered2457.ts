import assert from "node:assert/strict"
import { isDeepStrictEqual } from "node:util"
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { FanoutSolver } from "../../core/node_modules/@tscircuit/fanout-solver/lib/fanout-solver"
import { validateRoutedCopperDrc } from "../../core/node_modules/@tscircuit/fanout-solver/lib/validate-routed-copper-drc"
import { distancePointToObstacle } from "../../core/node_modules/@tscircuit/fanout-solver/lib/geometry"
import { getPlanVias } from "../../core/node_modules/@tscircuit/fanout-solver/lib/route-bus/plan-copper"
import { visualizeSimpleRouteJson } from "../../core/node_modules/@tscircuit/fanout-solver/lib/visualize-simple-route-json"
import { getSvgFromGraphicsObject } from "../../core/node_modules/graphics-debug"
const samples = ["butterstick-original","butterstick-spaced","glider-original","glider-spaced","h616-original","h616-spaced","icepi-original","icepi-spaced","imx6-original","imx6-spaced"]
const json = (path: string) => JSON.parse(path.endsWith(".gz") ? gunzipSync(readFileSync(path)).toString() : readFileSync(path,"utf8"))
const out = "audited-results"
mkdirSync(out)
const rows=[]
for (const sample of samples) {
  const directories = ["before","after"].map(mode => join(mode, "full-circuit-interception-"+sample, sample))
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
    const groups=new Map<string,number>()
    for(const plan of best.plans)groups.set(plan.busId,(groups.get(plan.busId)??0)+1)
    for(const bus of state.preparedBuses) {
      const count=groups.get(bus.busId)??0
      assert(count===0 || count===bus.connections.length,sample+" partial bus "+bus.busId)
    }
    return {report,args,state,best,drc,viaInPad,folder}
  })
  const [before,after]=captures
  assert(isDeepStrictEqual(before.args,after.args),sample+" fanout constructor inputs changed")
  const beforeSet=new Set<string>(before.best.plans.map(p=>p.connectionName))
  const afterSet=new Set<string>(after.best.plans.map(p=>p.connectionName))
  const gained=[...afterSet].filter(n=>!beforeSet.has(n)).sort()
  const lost=[...beforeSet].filter(n=>!afterSet.has(n)).sort()
  const pcbEqual=readFileSync(join(before.folder,"pcb.svg")).equals(readFileSync(join(after.folder,"pcb.svg")))
  const summary={
    sample,requested:before.args[0].connections.length,
    before:before.best.plans.length,after:after.best.plans.length,
    planes:captures.map(c=>c.best.plans.filter(p=>p.termination.type==="plane").length),
    vias:captures.map(c=>c.drc.checkedViaCount),
    assignments:captures.map(c=>c.state.attempts.length),
    gained,lost,inputsEqual:true,pcbSvgEqual:pcbEqual,
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
  if(gained.length || lost.length) {
    for(let index=0;index<captures.length;index++) {
      const capture=captures[index]
      const mode=index===0?"before":"after"
      const boundary=capture.args[1].sharedBoundary
      const halo=.5
      const obstacles=capture.args[0].obstacles.filter(o=>!o.isCopperPour && o.center.x+o.width/2>=boundary.minX-halo && o.center.x-o.width/2<=boundary.maxX+halo && o.center.y+o.height/2>=boundary.minY-halo && o.center.y-o.height/2<=boundary.maxY+halo)
      const graphics=visualizeSimpleRouteJson({...capture.best.outputSrj,obstacles,bounds:boundary,connections:[]})
      graphics.texts=[{x:boundary.minX,y:boundary.maxY+1,text:sample+": "+capture.best.plans.length+"/"+capture.args[0].connections.length+" partial fanout escapes; "+capture.drc.checkedViaCount+" vias",fontSize:.3,color:"#0f172a",anchorSide:"center_left"}]
      writeFileSync(join(out,sample+"-"+mode+".svg"),getSvgFromGraphicsObject(graphics,{backgroundColor:"white",svgWidth:1000,svgHeight:1000}))
    }
  }
  console.log("AUDIT_CASE",JSON.stringify(summary))
}
assert.equal(rows.length,10)
writeFileSync(join(out,"statistics.json"),JSON.stringify(rows,null,2)+"\n")
console.log("AUDIT_TOTALS",JSON.stringify({before:rows.reduce((s,r)=>s+r.before,0),after:rows.reduce((s,r)=>s+r.after,0),gained:rows.reduce((s,r)=>s+r.gained.length,0),lost:rows.reduce((s,r)=>s+r.lost.length,0),fullBoards:rows.filter(r=>r.fullCircuitStatus[1]==="complete").length,requested:rows.reduce((s,r)=>s+r.requested,0)}))
