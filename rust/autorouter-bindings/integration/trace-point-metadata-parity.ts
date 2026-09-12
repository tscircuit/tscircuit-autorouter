import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "../../../lib/types/high-density-types"
import { VertexShortcutPathSolver } from "../../../lib/solvers/SimplifiedPathSolver/VertexShortcutPathSolver"
import { importReference } from "./tsReference"

const { VertexShortcutPathSolver: Reference } = await importReference<typeof import("../../../lib/solvers/SimplifiedPathSolver/VertexShortcutPathSolver")>("lib/solvers/SimplifiedPathSolver/VertexShortcutPathSolver.ts")
type Mode = "addition" | "replacement" | "deletion"
function run(Solver:typeof Reference,mode:Mode):unknown {
  const original = {pcb_smtpad_id:"original"}
  const beforeStep = {pcb_smtpad_id:"before-step"}
  const afterStep = {pcb_smtpad_id:"after-step"}
  const route:HighDensityRoute={connectionName:"a",traceThickness:0.1,viaDiameter:0.3,route:[{x:0,y:0,z:0},{x:1,y:0,z:0}],vias:[]}
  if(mode!=="addition")for(const point of route.route)point.toNextSegmentCircuitJsonMetadata=original
  const solver=new Solver({inputRoute:route,otherHdRoutes:[],obstacles:[],colorMap:{},connMap:new ConnectivityMap({a:["a"]})})
  for(const point of route.route) {
    if(mode==="deletion")delete point.toNextSegmentCircuitJsonMetadata
    else point.toNextSegmentCircuitJsonMetadata=beforeStep
  }
  solver.step()
  for(const point of route.route)point.toNextSegmentCircuitJsonMetadata=afterStep
  original.pcb_smtpad_id="mutated-shared-original"
  const output=solver.newRoute
  const result={output,firstOwn:Object.hasOwn(output[0]!,"toNextSegmentCircuitJsonMetadata"),lastOwn:Object.hasOwn(output.at(-1)!,"toNextSegmentCircuitJsonMetadata"),
    firstOriginal:output[0]!.toNextSegmentCircuitJsonMetadata===original,
    lastBeforeStep:output.at(-1)!.toNextSegmentCircuitJsonMetadata===beforeStep,
    lastAfterStep:output.at(-1)!.toNextSegmentCircuitJsonMetadata===afterStep}
  if(solver instanceof VertexShortcutPathSolver)solver.dispose()
  return result
}
for(const mode of ["addition","replacement","deletion"] satisfies Mode[])assert.deepEqual(run(VertexShortcutPathSolver,mode),run(Reference,mode),mode)
console.log("Typed metadata addition/replacement/deletion preserve spread-time values and shared object identity")
