import { expect, test } from "bun:test"
import { applyPipeline9RegionalB01Repairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("regional routing repairs a single movable trace touching a foreign pad", (): void => {
  const { originalSrj, routes, syntheticConnectionNames, drcEvaluator } =
    createBoundedRegionalRepairFixture()
  routes.push({
    connectionName: "neighbor",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [{ x: -4, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }],
    vias: [],
  })
  originalSrj.connections.push({
    name: "neighbor",
    pointsToConnect: [
      { x: -4, y: 1, layer: "top", pcb_port_id: "neighbor_start" },
      { x: 4, y: 1, layer: "top", pcb_port_id: "neighbor_end" },
    ],
  })
  for (const [x, port] of [[-4, "neighbor_start"], [4, "neighbor_end"]] as const) {
    originalSrj.obstacles.push({
      type: "rect",
      center: { x, y: 1 },
      width: 0.3,
      height: 0.3,
      layers: ["top"],
      connectedTo: ["neighbor", port],
      circuitJsonMetadata: { pcb_smtpad_id: `${port}_pad`, pcb_port_id: port },
    })
  }
  const initial = drcEvaluator({ traces: [], routes })
  if (Array.isArray(initial)) throw new Error("Missing reference DRC result")
  expect(initial.errors).toHaveLength(1)
  const result = applyPipeline9RegionalB01Repairs({
    srj: originalSrj,
    routes,
    fixedObstacleRoutes: [],
    newConnections: originalSrj.connections,
    syntheticConnectionNames,
    drcEvaluator,
    preloadRepairTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(originalSrj),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })
  expect(result.acceptedCandidateCount).toBeGreaterThan(0)
  const final = drcEvaluator({ traces: [], routes: result.routes })
  if (Array.isArray(final)) throw new Error("Missing reference DRC result")
  expect(final.errors).toHaveLength(0)
  expect(result.routes[0]!.route[0]).toEqual(routes[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(routes[0]!.route.at(-1))
})
