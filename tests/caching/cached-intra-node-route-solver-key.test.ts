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

  it("changes when explicit port-point pairing changes", () => {
    const makePairAwareNode = (
      portPointPairIds: [string, string][],
    ): NodeWithPortPoints => ({
      capacityMeshNodeId: "cmn_pairs",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [
        {
          portPointId: "pp_1",
          connectionName: "shared",
          x: -2,
          y: 2,
          z: 0,
        },
        {
          portPointId: "pp_2",
          connectionName: "shared",
          x: -2,
          y: -2,
          z: 0,
        },
        {
          portPointId: "pp_3",
          connectionName: "shared",
          x: 2,
          y: -2,
          z: 0,
        },
        {
          portPointId: "pp_4",
          connectionName: "shared",
          x: 2,
          y: 2,
          z: 0,
        },
      ],
      portPointPairIds,
    })

    const solverA = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: makePairAwareNode([
        ["pp_1", "pp_3"],
        ["pp_2", "pp_4"],
      ]),
      traceWidth: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      hyperParameters: { SHUFFLE_SEED: 0 },
    })
    const solverB = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: makePairAwareNode([
        ["pp_1", "pp_2"],
        ["pp_3", "pp_4"],
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
