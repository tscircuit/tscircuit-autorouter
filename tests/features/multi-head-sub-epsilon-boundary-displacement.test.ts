import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { Frozen142EndpointForceSolver } from "tests/fixtures/Frozen142EndpointForceSolver"

test("boundary projection retains sub-EPS tangential displacement without changing the force-magnitude threshold", (): void => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "sub-epsilon-boundary-displacement",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [],
    },
  }
  // Independent force oracle for a movable point opposite a fixed vertical
  // segment at x=-2. Its two zero-length adjacent segments each contribute
  // one axial endpoint force and half of each fixed endpoint's reaction.
  const axialForce = 0.02 * Math.exp(-6 * 2)
  const radialDistance = Math.sqrt(2 * 2 + 1)
  const halfReaction = -((-2 / radialDistance) *
    (0.02 * Math.exp(-6 * radialDistance))) / 2
  let expectedTangentialForce = 0
  for (let segment = 0; segment < 2; segment++) {
    expectedTangentialForce += axialForce
    expectedTangentialForce += halfReaction
    expectedTangentialForce += halfReaction
  }
  expect(expectedTangentialForce).toBeGreaterThan(0)
  expect(expectedTangentialForce).toBeLessThan(1e-6)

  for (const y of [-1, 0]) {
    const lines: PolyLine2[] = [
      {
        connectionName: "movable",
        start: { x: 0, y, z1: 0, z2: 0 },
        mPoints: [{ x: 0, y, z1: 0, z2: 0 }],
        end: { x: 0, y, z1: 0, z2: 0 },
      },
      {
        connectionName: "fixed-segment",
        start: { x: -2, y: y - 1, z1: 0, z2: 0 },
        mPoints: [],
        end: { x: -2, y: y + 1, z1: 0, z2: 0 },
      },
    ]
    const before = structuredClone(lines)
    const referenceLines = structuredClone(lines)
    const solver = new MultiHeadPolyLineIntraNodeSolver2(params)
    const reference = new Frozen142EndpointForceSolver(params)
    const originalResult = reference.applyForcesToPolyLines(referenceLines)
    const result = solver.applyForcesToPolyLines(lines)
    expect(originalResult).toEqual({ lastStepMoved: false, magForceApplied: 0 })
    expect(referenceLines).toEqual(before)
    expect(result.magForceApplied).toBe(originalResult.magForceApplied)
    expect(result.lastStepMoved).toBe(y === -1)
    expect(lines[0]!.mPoints[0]!.x).toBe(y === -1 ? expectedTangentialForce : 0)
    expect(lines[0]!.mPoints[0]!.y).toBe(y === -1 ? -0.875 : 0)
    expect(lines[0]!.start).toEqual(before[0]!.start)
    expect(lines[0]!.end).toEqual(before[0]!.end)
    expect(lines[1]).toEqual(before[1])
  }
})
