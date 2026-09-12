import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { IntraNodeRouteSolver } from "../../../lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { SingleHighDensityRouteSolver } from "../../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { importReference } from "./tsReference"

const { IntraNodeRouteSolver: Reference } = await importReference<typeof import("../../../lib/solvers/HighDensitySolver/IntraNodeSolver")>("lib/solvers/HighDensitySolver/IntraNodeSolver.ts")
type Props = ConstructorParameters<typeof IntraNodeRouteSolver>[0]
const fixtures: Props[] = [{
  nodeWithPortPoints: {
    capacityMeshNodeId: "diagnostic-crossing", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", x: -2.5, y: -2.5, z: 0 },
      { connectionName: "a", x: 2.5, y: 2.5, z: 0 },
      { connectionName: "b", x: -2.5, y: 2.5, z: 0 },
      { connectionName: "b", x: 2.5, y: -2.5, z: 0 },
    ],
  }, captureSearchDebug: false,
}, JSON.parse(readFileSync(new URL("./fixtures/general-reroute-cmn0.json", import.meta.url), "utf8")) as Props]

function childState(child: SingleHighDensityRouteSolver | null): unknown {
  if (!child) return null
  return {
    connectionName: child.connectionName, rootConnectionName: child.rootConnectionName,
    iterations: child.iterations, maxIterations: child.MAX_ITERATIONS,
    solved: child.solved, failed: child.failed, progress: child.progress, error: child.error,
    A: child.A, B: child.B, solvedPath: child.solvedPath,
  }
}

for (const [index, fixture] of fixtures.entries()) {
  const clone = (): Props => {
    const props = structuredClone(fixture)
    if (props.connMap) props.connMap = Object.assign(new ConnectivityMap({}), props.connMap)
    props.captureSearchDebug = false
    return props
  }
  const actual = new IntraNodeRouteSolver(clone())
  const expected = new Reference(clone())
  const observed: Array<[SingleHighDensityRouteSolver, SingleHighDensityRouteSolver]> = []
  const retainedUnsolved = actual.unsolvedConnections
  assert.deepEqual(structuredClone(retainedUnsolved), structuredClone(expected.unsolvedConnections))
  while (!actual.solved && !actual.failed) {
    actual.step(); expected.step()
    if (retainedUnsolved) assert.equal(JSON.stringify(retainedUnsolved), JSON.stringify(expected.unsolvedConnections))
    assert.equal(actual.unsolvedConnections, retainedUnsolved)
    assert.deepEqual(structuredClone(actual.unsolvedConnections), structuredClone(expected.unsolvedConnections))
    assert.equal(JSON.stringify(actual.unsolvedConnections), JSON.stringify(expected.unsolvedConnections))
    assert.deepEqual([...actual.rerouteAttemptsByConnection], [...expected.rerouteAttemptsByConnection])
    assert.equal(JSON.stringify(childState(actual.activeSubSolver)), JSON.stringify(childState(expected.activeSubSolver)), `fixture ${index} step ${actual.iterations} active`)
    assert.deepEqual(actual.failedSubSolvers.map(childState), expected.failedSubSolvers.map(childState))
    assert.equal(actual.computeProgress(), expected.computeProgress())
    assert.equal(JSON.stringify(actual.solvedRoutes), JSON.stringify(expected.solvedRoutes))
    if (actual.activeSubSolver && !observed.some(([child]) => child === actual.activeSubSolver)) {
      observed.push([actual.activeSubSolver, expected.activeSubSolver!])
    }
    for (const [child, reference] of observed) {
      assert.equal(JSON.stringify(childState(child)), JSON.stringify(childState(reference)), `fixture ${index} step ${actual.iterations} retained`)
    }
  }
  assert.equal(actual.solved, expected.solved)
  assert.equal(actual.failed, expected.failed)
  assert.equal(actual.error, expected.error)
  actual.dispose()
  for (const [child, reference] of observed) assert.equal(JSON.stringify(childState(child)), JSON.stringify(childState(reference)))
  console.log(`General diagnostics fixture ${index}: ${actual.iterations} steps, ${observed.length} retained children`)
}
