import { expect, test } from "bun:test"
import { findRouteGeometryViolations } from "@tscircuit/high-density-a01-a11-a12"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import topologyMerge298 from "../fixtures/hd30-sample004-topology-merge-298.json"

test("Pipeline9 routes HD30 topology_merge_298 at native size with A11", () => {
  const nodeWithPortPoints = topologyMerge298 as NodeWithPortPoints
  const solver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints,
    connMap: new ConnectivityMap({}),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: { [nodeWithPortPoints.capacityMeshNodeId]: null },
    obstacles: [],
    layerCount: 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.highDensityResizeCount).toBe(0)
  expect(solver.stats.solverNodeCount).toEqual({ HighDensitySolverA11: 1 })
  expect(findRouteGeometryViolations(solver.routes)).toEqual([])

  const expectedPhysicalPairs = new Set(
    nodeWithPortPoints.portPointsInPairs!.map(([start, end]) =>
      [
        `${start.x},${start.y},${start.z}`,
        `${end.x},${end.y},${end.z}`,
      ]
        .sort()
        .join("|"),
    ),
  )
  const routedPhysicalPairs = new Set(
    solver.routes.map((route) =>
      [
        `${route.route[0]!.x},${route.route[0]!.y},${route.route[0]!.z}`,
        `${route.route.at(-1)!.x},${route.route.at(-1)!.y},${route.route.at(-1)!.z}`,
      ]
        .sort()
        .join("|"),
    ),
  )
  expect(routedPhysicalPairs).toEqual(expectedPhysicalPairs)
})
