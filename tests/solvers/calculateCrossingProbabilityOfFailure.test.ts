import { describe, expect, test } from "bun:test"
import { calculateNodeProbabilityOfFailure } from "../../lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import { getTunedTotalCapacity1 } from "../../lib/utils/getTunedTotalCapacity1"

describe("calculateNodeProbabilityOfFailure", () => {
  test("returns 0 for target nodes", () => {
    const p = calculateNodeProbabilityOfFailure(
      {
        capacityMeshNodeId: "n1",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0, 1],
        _containsTarget: true,
      } as any,
      10,
      10,
      10,
    )

    expect(p).toBe(0)
  })

  test("returns 1 for single-layer nodes with crossings", () => {
    const p = calculateNodeProbabilityOfFailure(
      {
        capacityMeshNodeId: "n2",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0],
      } as any,
      1,
      0,
      0,
    )

    expect(p).toBe(1)
  })

  test("uses tuned coefficients and clamps probability to [0, 1]", () => {
    const node = {
      capacityMeshNodeId: "n3",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
    } as any

    const p = calculateNodeProbabilityOfFailure(node, 2, 1, 3)

    const totalCapacity = getTunedTotalCapacity1(node)
    const estNumVias = 2 * 0.65 + 1 * 0.3 + 3 * 0.32
    const expected = Math.max(
      0,
      Math.min(1, (estNumVias / 1.8) ** 1.15 / totalCapacity),
    )

    expect(p).toBeCloseTo(expected, 10)
  })

  test("clamps very large values to 1", () => {
    const p = calculateNodeProbabilityOfFailure(
      {
        capacityMeshNodeId: "n4",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        availableZ: [0, 1],
      } as any,
      100,
      100,
      100,
    )

    expect(p).toBe(1)
  })
})
