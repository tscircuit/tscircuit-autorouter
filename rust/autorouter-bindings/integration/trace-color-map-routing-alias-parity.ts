import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { MultiSimplifiedPathSolver } from "../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { importReference } from "./tsReference"
const { MultiSimplifiedPathSolver: Reference } = await importReference<typeof import("../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver")>("lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver.ts")
function run(Solver: typeof Reference): unknown {
  const connMap = new ConnectivityMap({ n: ["n"], pad: ["pad"] })
  const colorMap = connMap.idToNetMap
  const route = { connectionName: "n", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0.5, z: 0 }, { x: 2, y: 0, z: 0 }], vias: [] }
  const obstacle = { type: "rect" as const, center: { x: 1, y: 0 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["pad"] }
  const solver = new Solver({ unsimplifiedHdRoutes: [route], obstacles: [obstacle], connMap, colorMap })
  colorMap.pad = colorMap.n!
  while (!solver.solved && !solver.failed) solver.step()
  const result = { routes: solver.simplifiedHdRoutes, iterations: solver.iterations, alias: solver.colorMap === connMap.idToNetMap }
  if (solver instanceof MultiSimplifiedPathSolver) solver.dispose()
  return result
}
assert.deepEqual(run(MultiSimplifiedPathSolver),run(Reference))
console.log("Color map shared with routing connectivity remains live")
