import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject } from "graphics-debug"
import nodeJson from "../../fixtures/bug-reports/bugreport101-cm5-spi-routing-timeout/bugreport101-cm5-spi-dominant-high-density-node.json" with {
  type: "json",
}
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"

test("Pipeline9 uses HighDensitySolverB02 for dense four-layer nodes", () => {
  const node = structuredClone(nodeJson) as NodeWithPortPoints
  const colorMap = generateColorMapFromNodeWithPortPoints(node)
  for (const portPoint of node.portPoints) {
    if (portPoint.rootConnectionName) {
      colorMap[portPoint.rootConnectionName] = colorMap[portPoint.connectionName]!
    }
  }
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 4,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    colorMap,
  })

  solver.step()
  const regularSolver = solver.activeRegularSolver
  expect(regularSolver).not.toBeNull()

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.routes).toHaveLength(11)
  expect(
    getSvgFromGraphicsObject({
      title: "Pipeline9 HighDensitySolverB02 routed node",
      lines: solver.routes.flatMap((route) =>
        route.route.slice(0, -1).map((point, pointIndex) => ({
          points: [point, route.route[pointIndex + 1]!],
          strokeColor: colorMap[route.connectionName] ?? "#111827",
          strokeWidth: route.traceThickness,
          strokeDash: point.z === 0 ? undefined : [0.1, 0.2],
          layer: `z${point.z}`,
          label: route.connectionName,
        })),
      ),
      points: node.portPoints.map((portPoint) => ({
        x: portPoint.x,
        y: portPoint.y,
        color: colorMap[portPoint.connectionName] ?? "#111827",
        label: `${portPoint.connectionName} z${portPoint.z}`,
      })),
      rects: [
        {
          center: node.center,
          width: node.width,
          height: node.height,
          fill: "rgba(15, 23, 42, 0.03)",
          stroke: "rgba(15, 23, 42, 0.5)",
          label: node.capacityMeshNodeId,
        },
      ],
      circles: solver.routes.flatMap((route) =>
        route.vias.map((via) => ({
          center: via,
          radius: route.viaDiameter / 2,
          fill: colorMap[route.connectionName] ?? "#111827",
          label: `${route.connectionName} via`,
        })),
      ),
    }, {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(
    regularSolver?.nodeSolveMetadataById.get(node.capacityMeshNodeId),
  ).toMatchObject({
    status: "solved",
    solverType: "HighDensitySolverB02",
    routeCount: 11,
  })
})
