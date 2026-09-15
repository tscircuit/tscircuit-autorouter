import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { Obstacle } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 preserves circular copper when routing a narrow via gap", () => {
  const obstacles: Obstacle[] = [-0.32, 0.32].flatMap((x) =>
    [-0.25, 0.25].map((y) => ({
      type: "rect" as const,
      shape: "circle" as const,
      center: { x, y },
      width: 0.2,
      height: 0.2,
      layers: ["bottom"],
      connectedTo: [`pad_${x}_${y}`],
    })),
  )
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "round-pad-via-gap",
    center: { x: 0, y: 0 },
    width: 0.44,
    height: 0.3,
    availableZ: [0, 1, 2, 3],
    portPoints: [
      { connectionName: "signal", x: 0, y: 0, z: 0 },
      { connectionName: "signal", x: 0, y: 0, z: 3 },
    ],
  }
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({ signal: ["signal"] }),
    obstacles,
    layerCount: 4,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    includeBoardObstacles: true,
    enableRegionalFallback: false,
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "No completed via route").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routes).toHaveLength(1)
  expect(solver.routes[0]!.vias.length).toBeGreaterThan(0)
  for (const via of solver.routes[0]!.vias) {
    for (const obstacle of obstacles) {
      const clearance =
        Math.hypot(via.x - obstacle.center.x, via.y - obstacle.center.y) -
        obstacle.width / 2 -
        0.15
      expect(clearance).toBeGreaterThanOrEqual(0.15 - 1e-9)
    }
  }
})
