import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { importReference } from "./tsReference"
import type { HighDensityRoute } from "../../../lib/types/high-density-types"
const { TraceSimplificationSolver: Reference } = await importReference<typeof import("../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver")>("lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver.ts")
function run(Solver:typeof Reference):unknown {
  const metadata={pcb_smtpad_id:"pad"}
  const routes:HighDensityRoute[]=[{connectionName:"a",rootConnectionName:"a",traceThickness:0.1,viaDiameter:0.3,
    route:[{x:0,y:0,z:0},{x:0,y:0,z:1,toNextSegmentType:undefined,toNextSegmentCircuitJsonMetadata:undefined},{x:2,y:0,z:1}],vias:[{x:0,y:0}],jumpers:undefined}]
  const solver=new Solver({hdRoutes:routes,obstacles:[{type:"rect",center:{x:0,y:0},width:1,height:1,layers:["top","bottom"],connectedTo:["a"],circuitJsonMetadata:metadata}],connMap:new ConnectivityMap({a:["a"]}),colorMap:{},layerCount:2,defaultViaDiameter:0.3})
  routes[0]!.route[0]!.x=5
  metadata.pcb_smtpad_id="live-pad"
  const output=solver.simplifiedHdRoutes
  const result={output,input:routes,metadataAlias:output[0]!.route[0]!.toNextSegmentCircuitJsonMetadata===metadata,
    copiedFirst:output[0]!.route[0]!==routes[0]!.route[0],copiedRoute:output[0]!==routes[0],copiedArray:output!==routes,
    removedType:!Object.hasOwn(output[0]!.route[1]!,"toNextSegmentType"),removedMetadata:!Object.hasOwn(output[0]!.route[1]!,"toNextSegmentCircuitJsonMetadata"),
    undefinedJumper:Object.hasOwn(output[0]!,"jumpers"),activeUndefined:solver.activeSubSolver===undefined}
  if(solver instanceof TraceSimplificationSolver)solver.dispose()
  return result
}
assert.deepEqual(run(TraceSimplificationSolver),run(Reference))
console.log("Outer marking preserves copied geometry, obstacle metadata alias, explicit property deletion and initial child state")
