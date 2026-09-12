import assert from "node:assert/strict"
import { importReference } from "./tsReference"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObstacleSpatialHashIndex } from "../../../lib/data-structures/ObstacleTree"
import { HighDensityRouteSpatialIndex } from "../../../lib/data-structures/HighDensityRouteSpatialIndex"
import { SingleRouteUselessViaRemovalSolver } from "../../../lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import { UselessViaRemovalSolver } from "../../../lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
const reference = await importReference<any>("lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver.ts")
const referenceObstacle = await importReference<any>("lib/data-structures/ObstacleTree.ts")
const referenceIndex = await importReference<any>("lib/data-structures/HighDensityRouteSpatialIndex.ts")

type Call = { method: string; args: unknown[] }
function create(native: boolean, calls: Call[], failure?: Error, late = false, mutateConnectivity = false): any {
  const route = { connectionName: "n", rootConnectionName: "n", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }, { x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }], vias: [{ x: 1, y: 0 }, { x: 2, y: 0 }] }
  const ObstacleClass = native ? ObstacleSpatialHashIndex : referenceObstacle.ObstacleSpatialHashIndex
  const IndexClass = native ? HighDensityRouteSpatialIndex : referenceIndex.HighDensityRouteSpatialIndex
  const SolverClass = native ? SingleRouteUselessViaRemovalSolver : reference.SingleRouteUselessViaRemovalSolver
  const obstacles = new ObstacleClass("rbush", [])
  const params = { unsimplifiedRoute: route, obstacleSHI: obstacles, hdRouteSHI: new IndexClass([route]), connMap: new ConnectivityMap({ n: ["n"] }) }
  const solver = late ? new SolverClass(params) : undefined
  const original = obstacles.searchArea.bind(obstacles)
  obstacles.searchArea = (...args: number[]): any => {
    calls.push({ method: "searchArea", args })
    if (failure) throw failure
    if (mutateConnectivity) {
      params.connMap.addConnections([["n", "pad"]])
      return [{ type: "rect", center: { x: 1.5, y: 0 }, width: 4, height: 2, layers: ["top", "bottom"], __zLayers: [0, 1], connectedTo: ["pad"] }]
    }
    return original(...args)
  }
  return late ? solver : new SolverClass(params)
}

for (const throwQuery of [false, true]) {
  const aCalls: Call[] = [], bCalls: Call[] = []
  const aError = new Error("query failure"), bError = new Error("query failure")
  const actual = create(true, aCalls, throwQuery ? aError : undefined, !throwQuery)
  const expected = create(false, bCalls, throwQuery ? bError : undefined, !throwQuery)
  const retainedIndex = actual.obstacleSHI
  const initialActualQuery = retainedIndex.searchArea.bind(retainedIndex)
  const initialExpectedQuery = expected.obstacleSHI.searchArea.bind(expected.obstacleSHI)
  retainedIndex.searchArea = (...args: number[]): any => initialActualQuery(...args)
  expected.obstacleSHI.searchArea = (...args: number[]): any => initialExpectedQuery(...args)
  for (let step = 0; step < 10 && !expected.solved && !expected.failed; step++) {
    let ae: unknown, be: unknown
    try { actual.step() } catch (error) { ae = error }
    try { expected.step() } catch (error) { be = error }
    assert.deepEqual(aCalls, bCalls)
    assert.equal(actual.failed, expected.failed)
    assert.equal(actual.iterations, expected.iterations)
    assert.equal(actual.obstacleSHI, retainedIndex)
    if (ae || be) {
      assert.equal(ae, aError); assert.equal(be, bError)
      // A caught user exception must release every native borrow guard.
      assert.equal(JSON.stringify(actual.getOptimizedHdRoute()), JSON.stringify(expected.getOptimizedHdRoute()))
      break
    }
    assert.equal(JSON.stringify(actual.getOptimizedHdRoute()), JSON.stringify(expected.getOptimizedHdRoute()))
  }
}

{
  const actualCalls: Call[] = [], expectedCalls: Call[] = []
  const actual = create(true, actualCalls, undefined, false, true)
  const expected = create(false, expectedCalls, undefined, false, true)
  while (!expected.solved && !expected.failed) {
    actual.step(); expected.step()
    assert.deepEqual(actualCalls, expectedCalls, "Mutating query order")
    assert.equal(JSON.stringify(actual.getOptimizedHdRoute()), JSON.stringify(expected.getOptimizedHdRoute()), "Query connectivity update applies within the same step")
    assert.equal(actual.iterations, expected.iterations)
    assert.equal(actual.solved, expected.solved)
  }
  assert.ok(actualCalls.length > 0, "Connectivity mutation callback must run")
}

const base = create(true, [])
const parent = new UselessViaRemovalSolver({ unsimplifiedHdRoutes: [base.unsimplifiedRoute], obstacles: [], layerCount: 2, colorMap: { n: "red" }, connMap: new ConnectivityMap({ n: ["n"] }) })
parent.step()
const child = parent.activeSubSolver!
assert.equal(child.hdRouteSHI, parent.hdRouteSHI)
assert.equal(child.obstacleSHI, parent.obstacleSHI)
assert.equal(child.getConstructorParams().hdRouteSHI, parent.hdRouteSHI)
assert.deepEqual(child.obstacleSHI.searchArea(0, 0, 1, 1), [])
console.log("Custom query calls, original exceptions, released borrows, and shared child indexes match")
