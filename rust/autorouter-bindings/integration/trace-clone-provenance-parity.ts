import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "../../../lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import { importReference } from "./tsReference"

const { SameNetViaMergerSolver: Reference } = await importReference<typeof import("../../../lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver")>("lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver.ts")
function run(Solver: typeof Reference): unknown {
  const metadata = { label: "constructor", absent: undefined }
  const points = [{ x:0,y:0,z:0,metadata },{ x:1,y:0,z:0,metadata }]
  const route = { connectionName:"a",rootConnectionName:"a",traceThickness:0.1,viaDiameter:0.3,route:points,vias:points,metadata,absent:undefined }
  const input = [route,{...route,connectionName:"b"},route]
  const solver = new Solver({inputHdRoutes:input,obstacles:[],colorMap:{},layerCount:2,connMap:new ConnectivityMap({a:["a"],b:["b"]})})
  metadata.label = "after constructor"
  const output = solver.mergedViaHdRoutes as typeof input
  const result = {
    values:output,
    duplicateRoute:output[0]===output[2],
    sharedRouteArray:output[0]!.route===output[1]!.route,
    routeViaAlias:output[0]!.route===output[0]!.vias,
    sharedPoint:output[0]!.route[0]===output[1]!.route[0],
    sharedMetadata:output[0]!.metadata===output[1]!.metadata && output[0]!.metadata===output[0]!.route[0]!.metadata,
    detachedMetadata:output[0]!.metadata!==metadata,
    absent:Object.hasOwn(output[0]!,"absent"),
    nestedAbsent:Object.hasOwn(output[0]!.metadata,"absent"),
  }
  if(solver instanceof SameNetViaMergerSolver)solver.dispose()
  return result
}
assert.deepEqual(run(SameNetViaMergerSolver),run(Reference))
console.log("Constructor structuredClone preserves alias graph, undefined properties and metadata timing")
