import assert from "node:assert/strict"
import { HighDensitySolver } from "../../../lib/solvers/HighDensitySolver/HighDensitySolver"
import { IntraNodeRouteSolver } from "../../../lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { NodeWithPortPoints } from "../../../lib/types/high-density-types"

const root = process.env.TSCIRCUIT_TS_REFERENCE
if (!root) throw new Error("Set TSCIRCUIT_TS_REFERENCE to the frozen TypeScript checkout")
const { HighDensitySolver: ReferenceBoard } = await import(`${root}/lib/solvers/HighDensitySolver/HighDensitySolver.ts`)
const { IntraNodeRouteSolver: ReferenceChild } = await import(`${root}/lib/solvers/HighDensitySolver/IntraNodeSolver.ts`)
const node: NodeWithPortPoints = { capacityMeshNodeId: "assigned-general", center: { x: 0, y: 0 }, width: 2, height: 2,
  availableZ: [0, 1], portPoints: [
    { connectionName: "a", x: -1, y: 0, z: 0 }, { connectionName: "a", x: 1, y: 0, z: 0 },
  ] }
const actual = new HighDensitySolver({ nodePortPoints: [] })
const reference = new ReferenceBoard({ nodePortPoints: [] })
const child = new IntraNodeRouteSolver({ nodeWithPortPoints: node })
const referenceChild = new ReferenceChild({ nodeWithPortPoints: structuredClone(node) })
actual.activeSubSolver = child
reference.activeSubSolver = referenceChild
const retainedRoutes = actual.routes
const retainedFailures = actual.failedSolvers
let steps = 0
while (!reference.solved && !reference.failed) {
  assert.ok(steps < 5000, "Assigned General exceeded fixture budget")
  actual.step()
  reference.step()
  assert.equal(actual.routes, retainedRoutes, "Board route array identity")
  assert.equal(actual.failedSolvers, retainedFailures, "Board failed array identity")
  for (const key of ["iterations", "solved", "failed", "error", "MAX_ITERATIONS", "progress"] as const) {
    assert.equal(JSON.stringify(actual[key]), JSON.stringify(reference[key]), `Board ${key} step ${steps}`)
    assert.equal(JSON.stringify(child[key]), JSON.stringify(referenceChild[key]), `Retained General ${key} step ${steps}`)
  }
  assert.equal(JSON.stringify(actual.routes), JSON.stringify(reference.routes), `Board routes step ${steps}`)
  assert.equal(JSON.stringify(child.solvedRoutes), JSON.stringify(referenceChild.solvedRoutes), `Child routes step ${steps}`)
  assert.equal(actual.activeSubSolver === child, reference.activeSubSolver === referenceChild, "Assigned child identity")
  steps++
}
console.log(`Direct General orchestration parity passed: ${steps} steps, exact states/routes and retained child/array identities`)
