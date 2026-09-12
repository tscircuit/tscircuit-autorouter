import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { MultiSimplifiedPathSolver } from "../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { importReference } from "./tsReference"
const { MultiSimplifiedPathSolver: Reference } = await importReference<typeof import("../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver")>("lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver.ts")
function run(Solver: typeof Reference): unknown {
  const colorMap = { n: "red" }
  const input = { connectionName: "n", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0.4, z: 0 }, { x: 2, y: 0, z: 0 }], vias: [] }
  const solver = new Solver({ unsimplifiedHdRoutes: [input], obstacles: [], colorMap, connMap: new ConnectivityMap({ n: ["n"] }) })
  colorMap.n = "blue"
  solver.step()
  const child = solver.activeSubSolver!
  const map = child.colorMap
  const first = { parentAlias: solver.colorMap === colorMap, childAlias: map === colorMap, color: map.n }
  colorMap.n = "green"
  solver.step()
  const second = { retained: child.colorMap === map, color: map.n, original: colorMap.n, graphics: child.visualize() }
  const replacement = { n: "purple" }
  solver.colorMap = replacement
  colorMap.n = "orange"
  solver.step()
  const replaced = { parent: solver.colorMap === replacement, child: child.colorMap === colorMap, oldColor: child.colorMap.n, newColor: solver.colorMap.n }
  while (!solver.solved && !solver.failed) solver.step()
  const result = { first, second, replaced, routes: solver.simplifiedHdRoutes, iterations: solver.iterations }
  if (solver instanceof MultiSimplifiedPathSolver) solver.dispose()
  return result
}
assert.deepEqual(run(MultiSimplifiedPathSolver), run(Reference))
console.log("Color map aliases and mutations match across child creation and retained children")
