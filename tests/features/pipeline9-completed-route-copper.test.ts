import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("regional repair receives completed ordinary copper constraints", (): void => {
  const horizontalNode: NodeWithPortPoints = {
    capacityMeshNodeId: "completed_neighbor",
    center: { x: 0, y: 0 },
    width: 4,
    height: 1,
    availableZ: [0],
    portPoints: [
      { x: -2, y: 0, z: 0, connectionName: "horizontal" },
      { x: 2, y: 0, z: 0, connectionName: "horizontal" },
    ],
  }
  const crossingNode: NodeWithPortPoints = {
    capacityMeshNodeId: "overlapping_repair_region",
    center: { x: 0, y: 0 },
    // A region wider than B01's limit uses the regional routing portfolio.
    width: 16,
    height: 4,
    availableZ: [0],
    portPoints: [
      { x: 0, y: -2, z: 0, connectionName: "vertical" },
      { x: 0, y: 2, z: 0, connectionName: "vertical" },
    ],
  }
  const solver = new Pipeline9HighDensitySolver({
    // Nodes are consumed from the end; the horizontal trace is routed first.
    nodePortPoints: [crossingNode, horizontalNode],
    fixedHdRoutes: [
      {
        connectionName: "existing_corner_copper",
        rootConnectionName: "existing_corner_copper",
        preloadedTraceIndex: 0,
        preloadedRouteIndex: 0,
        isFixed: true,
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 7, y: 1, z: 0 },
          { x: 7.5, y: 1, z: 0 },
        ],
        vias: [],
      },
    ],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })

  while (!solver.activeFallbackSolver && !solver.failed) solver.step()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.routes).toHaveLength(1)
  expect(solver.routes[0]!.connectionName).toBe("horizontal")
  const regionalSolver = solver.activeFallbackSolver!
  expect(regionalSolver).toBeDefined()
  expect(
    regionalSolver.params.obstacles.some((obstacle) =>
      obstacle.connectedTo.includes("horizontal"),
    ),
  ).toBeTrue()
  expect(solver.getUpdatedFixedHdRoutes()).toHaveLength(1)
})
