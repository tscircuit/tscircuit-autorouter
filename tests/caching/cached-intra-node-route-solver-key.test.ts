import { describe, expect, it } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const makeNode = (): NodeWithPortPoints => ({
  capacityMeshNodeId: "cmn_test",
  center: { x: 0, y: 0 },
  width: 2,
  height: 1,
  availableZ: [0, 1],
  portPoints: [
    { connectionName: "A", x: -1, y: -0.5, z: 0 },
    { connectionName: "A", x: 1, y: -0.5, z: 0 },
    { connectionName: "B", x: -1, y: 0.5, z: 1 },
    { connectionName: "B", x: 1, y: 0.5, z: 1 },
  ],
})

/**
 * Creates a test node whose routing changes when explicit port-point pairing
 * changes.
 *
 * @param portPointPairIds - Explicit pair ids to attach to the node.
 * @returns A node with four same-connection port points and the provided
 * explicit pairing.
 */
const makeNodeWithPairIds = (
  portPointPairIds: [string, string][],
): NodeWithPortPoints => ({
  capacityMeshNodeId: "cmn_test_pairs",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  availableZ: [0],
  portPointPairIds,
  portPoints: [
    { connectionName: "A", portPointId: "a1", x: -1, y: -1, z: 0 },
    { connectionName: "A", portPointId: "a2", x: 1, y: -1, z: 0 },
    { connectionName: "A", portPointId: "a3", x: -1, y: 1, z: 0 },
    { connectionName: "A", portPointId: "a4", x: 1, y: 1, z: 0 },
  ],
})

describe("CachedIntraNodeRouteSolver cache key", () => {
  it("changes when traceWidth changes", () => {
    const solverA = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: makeNode(),
      traceWidth: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      hyperParameters: { SHUFFLE_SEED: 0 },
    })
    const solverB = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: makeNode(),
      traceWidth: 0.1,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      hyperParameters: { SHUFFLE_SEED: 0 },
    })

    expect(solverA.computeCacheKeyAndTransform().cacheKey).not.toBe(
      solverB.computeCacheKeyAndTransform().cacheKey,
    )
  })

  it("changes when viaDiameter changes", () => {
    const solverA = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: makeNode(),
      traceWidth: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      hyperParameters: { SHUFFLE_SEED: 0 },
    })
    const solverB = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: makeNode(),
      traceWidth: 0.15,
      viaDiameter: 0.25,
      obstacleMargin: 0.15,
      hyperParameters: { SHUFFLE_SEED: 0 },
    })

    expect(solverA.computeCacheKeyAndTransform().cacheKey).not.toBe(
      solverB.computeCacheKeyAndTransform().cacheKey,
    )
  })

  it("changes when explicit port point pair ids change", () => {
    const solverA = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: makeNodeWithPairIds([
        ["a1", "a2"],
        ["a3", "a4"],
      ]),
      traceWidth: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      hyperParameters: { SHUFFLE_SEED: 0 },
    })
    const solverB = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: makeNodeWithPairIds([
        ["a1", "a4"],
        ["a2", "a3"],
      ]),
      traceWidth: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      hyperParameters: { SHUFFLE_SEED: 0 },
    })

    expect(solverA.computeCacheKeyAndTransform().cacheKey).not.toBe(
      solverB.computeCacheKeyAndTransform().cacheKey,
    )
  })
})
