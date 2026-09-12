import assert from "node:assert/strict"
import { IntraNodeRouteSolver } from "../../../lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { SingleHighDensityRouteSolver } from "../../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { importReference } from "./tsReference"

const { IntraNodeRouteSolver: Reference } = await importReference<typeof import("../../../lib/solvers/HighDensitySolver/IntraNodeSolver")>("lib/solvers/HighDensitySolver/IntraNodeSolver.ts")
type Props = ConstructorParameters<typeof IntraNodeRouteSolver>[0]
function view(child: SingleHighDensityRouteSolver): unknown {
  return {
    connectionName: child.connectionName, rootConnectionName: child.rootConnectionName,
    A: child.A, B: child.B, obstacleRoutes: child.obstacleRoutes,
    futureConnections: child.futureConnections, availableZ: child.availableZ,
    layerCount: child.layerCount, solvedPath: child.solvedPath,
  }
}
const props: Props = {
  nodeWithPortPoints: {
    capacityMeshNodeId: "typed-single-input", center: { x: 0, y: 0 }, width: 6, height: 6,
    availableZ: [1, 0, 1],
    portPoints: [
      { x: -3, y: -2, z: 0, connectionName: "2", rootConnectionName: "root2", portPointId: "2a" },
      { x: 3, y: -2, z: 0, connectionName: "2", rootConnectionName: "root2", portPointId: "2b" },
      { x: -3, y: 0, z: 0, connectionName: "10", rootConnectionName: "root10", portPointId: "10a" },
      { x: 3, y: 0, z: 0, connectionName: "10", rootConnectionName: "root10", portPointId: "10b" },
      { x: -3, y: 2, z: 0, connectionName: "a", rootConnectionName: "rootA", portPointId: "aa" },
      { x: 3, y: 2, z: 0, connectionName: "a", rootConnectionName: "rootA", portPointId: "ab" },
    ],
  }, captureSearchDebug: false,
}
const actual = new IntraNodeRouteSolver(structuredClone(props))
const expected = new Reference(structuredClone(props))
let compared = 0
let withObstacles = 0
try {
  while (!expected.solved && !expected.failed) {
    assert.ok(expected.iterations < 10000, "Simple parallel routes exceeded the fixture budget")
    actual.step(); expected.step()
    assert.equal(actual.solved, expected.solved)
    assert.equal(actual.failed, expected.failed)
    const a = actual.activeSubSolver, e = expected.activeSubSolver
    assert.equal(Boolean(a), Boolean(e))
    if (a && e) {
      // Byte comparison preserves nested route/property and connection insertion order.
      assert.equal(JSON.stringify(view(a)), JSON.stringify(view(e)))
      if (e.obstacleRoutes.length) withObstacles++
      compared++
    }
    assert.equal(JSON.stringify(actual.solvedRoutes), JSON.stringify(expected.solvedRoutes))
  }
  assert.equal(actual.solved, true)
  assert.ok(compared > 0)
  assert.ok(withObstacles > 0, "Exercise an owned solved route crossing into a later search constructor")
  console.log(`General→Single input parity: ${compared} child snapshots, ${withObstacles} with obstacle routes`)
} finally { actual.dispose() }
