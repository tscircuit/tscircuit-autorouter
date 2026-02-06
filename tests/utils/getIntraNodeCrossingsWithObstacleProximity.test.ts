import { describe, expect, it } from "bun:test"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { applyObstacleProximityWeighting } from "lib/utils/getIntraNodeCrossingsWithObstacleProximity"

describe("getIntraNodeCrossingsWithObstacleProximity", () => {
  const createNode = (overrides = {}): CapacityMeshNode => ({
    capacityMeshNodeId: "node1",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layer: "top",
    availableZ: [0, 1],
    ...overrides,
  })

  const createObstacle = (id = "obs1", center = { x: 0, y: 0 }) => ({
    type: "rect" as const,
    obstacleId: id,
    center,
    width: 0.5,
    height: 0.5,
    layers: ["top"],
    connectedTo: [],
  })

  const createSimpleRouteJson = (
    obstacles: ReturnType<typeof createObstacle>[],
  ): SimpleRouteJson => ({
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles,
    connections: [],
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  })

  it("applies no weighting when there are no obstacles", () => {
    const node = createNode()

    const result = applyObstacleProximityWeighting(
      node,
      3, // numSameLayerCrossings
      2, // numEntryExitLayerChanges
      1, // numTransitionPairCrossings
      undefined, // no simpleRouteJson, no obstacles
    )

    expect(result.numProximityWeightedSameLayerCrossings).toBe(3)
    expect(result.numProximityWeightedEntryExitLayerChanges).toBe(2)
    expect(result.numProximityWeightedTransitionPairCrossings).toBe(1)
  })

  it("applies 1.2x weighting with one intersecting obstacle", () => {
    const node = createNode()
    const simpleRouteJson = createSimpleRouteJson([createObstacle()])

    const result = applyObstacleProximityWeighting(
      node,
      3, // numSameLayerCrossings
      2, // numEntryExitLayerChanges
      1, // numTransitionPairCrossings
      simpleRouteJson,
    )

    // Should be weighted by 1.2
    expect(result.numProximityWeightedSameLayerCrossings).toBeCloseTo(3.6)
    expect(result.numProximityWeightedEntryExitLayerChanges).toBeCloseTo(2.4)
    expect(result.numProximityWeightedTransitionPairCrossings).toBeCloseTo(1.2)
  })

  it("applies higher weighting with multiple obstacles", () => {
    const node = createNode()
    const obstacles = [
      createObstacle("obs1"),
      createObstacle("obs2"),
      createObstacle("obs3"),
    ]
    const simpleRouteJson = createSimpleRouteJson(obstacles)

    const result = applyObstacleProximityWeighting(
      node,
      4, // numSameLayerCrossings
      2, // numEntryExitLayerChanges
      1, // numTransitionPairCrossings
      simpleRouteJson,
    )

    // With 3 obstacles: weight = 1.2 + (3-1)*0.15 = 1.2 + 0.3 = 1.5
    expect(result.numProximityWeightedSameLayerCrossings).toBeCloseTo(6) // 4 * 1.5
    expect(result.numProximityWeightedEntryExitLayerChanges).toBeCloseTo(3) // 2 * 1.5
    expect(result.numProximityWeightedTransitionPairCrossings).toBeCloseTo(1.5) // 1 * 1.5
  })

  it("does not weight non-intersecting obstacles", () => {
    const node = createNode()
    const obstacles = [createObstacle("obs1", { x: 10, y: 10 })]
    const simpleRouteJson = createSimpleRouteJson(obstacles)

    const result = applyObstacleProximityWeighting(
      node,
      3,
      2,
      1,
      simpleRouteJson,
    )

    // No intersection means no weighting
    expect(result.numProximityWeightedSameLayerCrossings).toBe(3)
    expect(result.numProximityWeightedEntryExitLayerChanges).toBe(2)
    expect(result.numProximityWeightedTransitionPairCrossings).toBe(1)
  })

  it("preserves original crossing counts", () => {
    const node = createNode()

    const result = applyObstacleProximityWeighting(node, 5, 3, 2, undefined)

    expect(result.numSameLayerCrossings).toBe(5)
    expect(result.numEntryExitLayerChanges).toBe(3)
    expect(result.numTransitionPairCrossings).toBe(2)
  })
})
