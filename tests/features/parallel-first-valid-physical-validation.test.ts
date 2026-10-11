import { expect, test } from "bun:test"
import { validateFirstValidHighDensityRoutes, type FirstValidRouteValidationParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/validateFirstValidHighDensityRoutes"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import { createFirstValidNode, createFirstValidRoute } from "tests/fixtures/first-valid-hd-fixtures"

test("competitive validation checks physical widths, pair coverage, legal vias and fixed board copper", (): void => {
  const node = createFirstValidNode()
  const route = createFirstValidRoute(node)
  const params: FirstValidRouteValidationParams = { node, routes: [route],
    traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1, layerCount: 2, obstacles: [] }
  expect(validateFirstValidHighDensityRoutes(params)).toEqual({ valid: true })
  expect(validateFirstValidHighDensityRoutes({ ...params, traceWidth: 0.2 })).toEqual({ valid: false, reason: "trace-width" })
  expect(validateFirstValidHighDensityRoutes({ ...params, viaDiameter: 0.4 })).toEqual({ valid: false, reason: "via-diameter" })
  expect(validateFirstValidHighDensityRoutes({ ...params, routes: [] })).toEqual({ valid: false, reason: "missing-port-pair" })
  const nonfinite = structuredClone(route)
  nonfinite.route[0]!.x = Infinity
  expect(validateFirstValidHighDensityRoutes({ ...params, routes: [nonfinite] })).toEqual({ valid: false, reason: "nonfinite-geometry" })
  const unavailable = structuredClone(route)
  unavailable.route.splice(1, 0, { x: 0, y: 0, z: 2 })
  expect(validateFirstValidHighDensityRoutes({ ...params, routes: [unavailable] })).toEqual({ valid: false, reason: "noncolocated-via" })
  const legalVia: HighDensityIntraNodeRoute = { ...route,
    route: [{ x: -2, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: -1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    vias: [{ x: -1, y: 0 }, { x: 1, y: 0 }] }
  expect(validateFirstValidHighDensityRoutes({ ...params, routes: [legalVia] })).toEqual({ valid: true })
  expect(validateFirstValidHighDensityRoutes({ ...params, routes: [{ ...legalVia, vias: [] }] })).toEqual({ valid: false, reason: "missing-via" })
  expect(validateFirstValidHighDensityRoutes({ ...params, routes: [{ ...route, vias: [{ x: 0, y: 0 }] }] })).toEqual({ valid: false, reason: "unused-via" })
  expect(validateFirstValidHighDensityRoutes({ ...params, routes: [legalVia], node: { ...node, availableZ: [0] } })).toEqual({ valid: false, reason: "unavailable-layer" })
  const nearbyNode: NodeWithPortPoints = { ...node, portPoints: [...node.portPoints,
    { connectionName: "neighbor", x: -2, y: 0.249, z: 0 },
    { connectionName: "neighbor", x: 2, y: 0.249, z: 0 }] }
  const neighbor: HighDensityIntraNodeRoute = { ...route, connectionName: "neighbor",
    route: [{ x: -2, y: 0.249, z: 0 }, { x: 2, y: 0.249, z: 0 }] }
  expect(validateFirstValidHighDensityRoutes({ ...params, node: nearbyNode, routes: [route, neighbor] })).toEqual({ valid: false, reason: "copper-drc" })
  const separatedNode = { ...nearbyNode, portPoints: nearbyNode.portPoints.map((point) => ({
    ...point, y: point.connectionName === "neighbor" ? 0.251 : point.y })) }
  const separated = { ...neighbor, route: neighbor.route.map((point) => ({ ...point, y: 0.251 })) }
  expect(validateFirstValidHighDensityRoutes({ ...params, node: separatedNode, routes: [route, separated] })).toEqual({ valid: true })
  const widened = { ...route, route: route.route.map((point) => ({ ...point, traceThickness: 0.5 })) }
  expect(validateFirstValidHighDensityRoutes({ ...params, node: separatedNode, routes: [widened, separated] })).toEqual({ valid: false, reason: "copper-drc" })
  expect(validateFirstValidHighDensityRoutes({ ...params, obstacles: [{ type: "rect", center: { x: 0, y: 0 },
    width: 0.3, height: 0.3, layers: ["top"], connectedTo: [] }] })).toEqual({ valid: false, reason: "fixed-obstacle" })
  expect(validateFirstValidHighDensityRoutes({ ...params,
    boardGeometry: { bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 } } })).toEqual({ valid: false, reason: "copper-drc" })
  expect(validateFirstValidHighDensityRoutes({ ...params, obstacles: [{ type: "rect", center: { x: -2, y: 0 },
    width: 0.3, height: 0.3, layers: ["top"], connectedTo: ["signal"] }] })).toEqual({ valid: true })
})
