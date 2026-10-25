import { expect, test } from "bun:test"
import { OwnerCutHighDensitySolver } from "lib/solvers/HighDensitySolver/OwnerCutHighDensitySolver"
import { ownerCutParams } from "./ownerCutTestUtils"

test("frozen native copper produces a learned cut and a paid-owner witness", (): void => {
  const params = ownerCutParams()
  params.nodeWithPortPoints.width = 0.6
  params.nodeWithPortPoints.height = 0.6
  params.nodeWithPortPoints.portPoints = [
    [[0.3, 0, 0], [-0.3, 0, 0]],
    [[0.3, 0, 1], [-0.3, 0, 1]],
    [[0, 0.3, 0], [0, -0.3, 0]],
  ].flatMap((points, index) => points.map(([x, y, z]) => ({
    x: x!, y: y!, z: z!, connectionName: `signal-${index}`,
  })))
  const solver = new OwnerCutHighDensitySolver(params)
  for (let step = 0; step < 30 && !solver.solved && !solver.failed &&
    !params.ownerCutDiagnostics!.ownerCutLearnedCuts; step++) solver.step()
  expect(solver.error).toBeNull()
  expect(params.ownerCutDiagnostics!.ownerCutLearnedCuts).toBeGreaterThan(0)
  expect(params.ownerCutDiagnostics!.ownerCutMasterAssignments).toBeGreaterThan(0)
  expect(params.ownerCutDiagnostics!.ownerCutActivatedOwners).toBeGreaterThan(0)
  expect(params.ownerCutDiagnostics!.ownerCutFound).toBeGreaterThan(0)
  // A provisional graph witness cannot mark this dense board physically solved.
  expect(solver.solved).toBe(false)
})
