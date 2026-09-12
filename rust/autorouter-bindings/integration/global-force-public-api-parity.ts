import assert from "node:assert/strict"
import { GlobalDrcForceImproveSolver } from "../../../lib/bindings/repair/GlobalDrcForceImproveSolver"
import { importReference } from "./tsReference"
import type { GlobalDrcForceImproveSolverParams, HighDensityRoute } from "high-density-repair03/lib"
const { GlobalDrcForceImproveSolver: ReferenceSolver } = await importReference<typeof import("high-density-repair03/lib")>("node_modules/high-density-repair03/lib/index.ts")
const params:GlobalDrcForceImproveSolverParams={
  srj:{bounds:{minX:-2,minY:-2,maxX:2,maxY:2},connections:[{name:"a",pointsToConnect:[]}],obstacles:[],layerCount:2,minTraceWidth:0.1},
  hdRoutes:[{connectionName:"a",route:[{x:-1,y:0,z:0},{x:1,y:0,z:0}],vias:[]}],
  enablePostSolveClearanceRelaxation:false,
}
function run(Solver:typeof ReferenceSolver):unknown {
  const solver=new Solver(structuredClone(params))
  const output:HighDensityRoute[]=structuredClone(params.hdRoutes)
  output[0]!.route[0]!.y=0.5
  solver.outputHdRoutes=output
  solver.MAX_ITERATIONS=1
  solver.stats={userMarker:123}
  assert.equal(solver.outputHdRoutes,output)
  solver.step()
  assert.equal(solver.getOutput(),output)
  assert.equal(solver.getOutput(),solver.outputHdRoutes)
  return {output:solver.getOutput(),stats:solver.stats,iterations:solver.iterations,solved:solver.solved,failed:solver.failed,MAX_ITERATIONS:solver.MAX_ITERATIONS}
}
assert.equal(JSON.stringify(run(GlobalDrcForceImproveSolver)),JSON.stringify(run(ReferenceSolver)))
console.log("Public output assignment, iteration limit, stats and repeated output identity match TypeScript")
