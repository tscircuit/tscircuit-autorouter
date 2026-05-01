import { describe, expect, it } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const makeNode = (center = { x: 0, y: 0 }): NodeWithPortPoints => ({
  capacityMeshNodeId: "cmn_test",
  center,
  width: 2,
  height: 1,
  availableZ: [0, 1],
  portPoints: [
    { connectionName: "A", x: center.x - 1, y: center.y - 0.5, z: 0 },
    { connectionName: "A", x: center.x + 1, y: center.y - 0.5, z: 0 },
    { connectionName: "B", x: center.x - 1, y: center.y + 0.5, z: 1 },
    { connectionName: "B", x: center.x + 1, y: center.y + 0.5, z: 1 },
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

  it("reuses the same key for translated nodes with different connection names", () => {
    const solverA = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: makeNode({ x: 0, y: 0 }),
      traceWidth: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      hyperParameters: { SHUFFLE_SEED: 0 },
    })
    const solverB = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: {
        ...makeNode({ x: 10, y: -5 }),
        portPoints: makeNode({ x: 10, y: -5 }).portPoints.map((point) => ({
          ...point,
          connectionName: point.connectionName === "A" ? "C" : "D",
        })),
      },
      traceWidth: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      hyperParameters: { SHUFFLE_SEED: 0 },
    })

    expect(solverA.computeCacheKeyAndTransform().cacheKey).toBe(
      solverB.computeCacheKeyAndTransform().cacheKey,
    )
  })
})
