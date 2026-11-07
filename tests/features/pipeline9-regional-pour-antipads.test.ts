import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("regional routing permits through-via antipads while keeping solid pad clearance", (): void => {
  const portPoints = [
    { x: -2, y: 0, z: 0, connectionName: "a" },
    { x: 2, y: 0, z: 0, connectionName: "a" },
    { x: 0, y: -2, z: 0, connectionName: "b" },
    { x: 0, y: 2, z: 0, connectionName: "b" },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cross",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1, 2, 3],
    portPoints,
    portPointsInPairs: [
      [portPoints[0]!, portPoints[1]!],
      [portPoints[2]!, portPoints[3]!],
    ],
  }
  for (const isCopperPour of [false, true]) {
    const obstacle: Obstacle = {
      type: "rect",
      isCopperPour,
      center: { x: 0, y: 0 },
      width: 100,
      height: 100,
      layers: ["inner1", "inner2"],
      zLayers: [1, 2],
      __zLayers: [1, 2],
      connectedTo: ["GND"],
    }
    const solver = new Pipeline9RegionalFallbackSolver({
      nodeWithPortPoints: node,
      connMap: new ConnectivityMap({ a: ["a"], b: ["b"], GND: ["GND"] }),
      colorMap: {},
      viaDiameter: 0.45,
      traceWidth: 0.1,
      obstacleMargin: 0.1,
      viaToPadClearance: 0.1,
      effort: 1,
      layerCount: 4,
      boardGeometry: { bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } },
      obstacles: [obstacle],
      boardObstacles: [obstacle],
      movablePreloadedConnectionNames: new Set(["a", "b"]),
      allowBlindAndBuriedVias: false,
    })
    solver.solve()
    expect(solver.solved).toBe(isCopperPour)
    expect(solver.failed).toBe(!isCopperPour)
    if (!isCopperPour) continue
    const routes = solver.getOutput()
    expect(routes).toHaveLength(2)
    expect(routes.flatMap((route) => route.vias).length).toBeGreaterThan(0)
    expect(solver.stats.preloadedViaCandidateRejectionCount).toBe(0)
    expect(solver.params.obstacles).toEqual([obstacle])
  }
})
