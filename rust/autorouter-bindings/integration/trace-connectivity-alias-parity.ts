import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { MultiSimplifiedPathSolver } from "../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { importReference } from "./tsReference"

const { MultiSimplifiedPathSolver: Reference } = await importReference<typeof import("../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver")>("lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver.ts")

function run(Solver: typeof Reference): unknown {
  const original = new ConnectivityMap({ a: ["a"], b: ["b"] })
  const route = (connectionName: string, y: number): any => ({ connectionName, traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y, z: 0 }, { x: 1, y: y + 0.1, z: 0 }, { x: 2, y, z: 0 }], vias: [] })
  const solver = new Solver({ unsimplifiedHdRoutes: [route("a", 0), route("b", 1)], obstacles: [], connMap: original })
  solver.step()
  const child = solver.activeSubSolver!
  assert.ok(child, "First step must create an active path child")
  assert.equal(child.connMap, original)
  const snapshots: unknown[] = []
  const snapshot = (label: string): void => {
    snapshots.push({ label, parentMap: JSON.stringify(solver.connMap), childMap: JSON.stringify(child.connMap), childOriginal: child.connMap === original, parentOriginal: solver.connMap === original, childIterations: child.iterations, childRoute: JSON.stringify(child.simplifiedRoute) })
  }
  original.addConnections([["a", "pad"]])
  solver.step()
  snapshot("addConnections")
  original.idToNetMap.pad = original.idToNetMap.b!
  solver.step()
  snapshot("direct idToNetMap mutation")
  const replacement = new ConnectivityMap({ replacement: ["a", "b", "pad"] })
  solver.connMap = replacement
  solver.step()
  snapshot("parent instance replacement leaves existing child attached")
  assert.equal(solver.connMap, replacement)
  assert.equal(child.connMap, original)
  original.addConnections([["a", "late-pad"]])
  solver.step()
  snapshot("retained child original mutated after replacement")
  child.connMap = replacement
  solver.step()
  snapshot("explicit child instance replacement")
  assert.equal(child.connMap, replacement)
  solver.solve()
  const result = { snapshots, routes: solver.simplifiedHdRoutes, iterations: solver.iterations, solved: solver.solved, failed: solver.failed, error: solver.error }
  if (solver instanceof MultiSimplifiedPathSolver) solver.dispose()
  return result
}

function runUnobserved(Solver: typeof Reference): unknown {
  const connMap = new ConnectivityMap({ a: ["a"], b: ["b"], pad: ["pad"] })
  const routes = ["a", "b"].map(connectionName => ({ connectionName, traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0.5, z: 0 }, { x: 2, y: 0, z: 0 }], vias: [] }))
  const solver = new Solver({ unsimplifiedHdRoutes: routes, connMap, obstacles: [{ type: "rect", center: { x: 1, y: 0 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["pad"] }] })
  solver.step()
  connMap.addConnections([["b", "pad", "a"]])
  connMap.netMap.extra = ["diagnostic-only"]
  while (!solver.solved && !solver.failed) solver.step()
  const result = { routes: solver.simplifiedHdRoutes, iterations: solver.iterations, connMap: solver.connMap }
  if (solver instanceof MultiSimplifiedPathSolver) solver.dispose()
  return result
}

assert.deepEqual(runUnobserved(MultiSimplifiedPathSolver), runUnobserved(Reference))
assert.deepEqual(run(MultiSimplifiedPathSolver), run(Reference))
console.log("Active child connectivity mutations and instance replacement match the frozen reference")
