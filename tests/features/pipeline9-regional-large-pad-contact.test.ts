import { expect, test } from "bun:test"
import {
  getPipeline9RegionalB01CandidateOutput,
  getRepairCenter,
  preparePipeline9RegionalB01Candidate,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("a large pad repair window includes the actual contact and legal outside transition", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 6, y: 0, z: 1, pcb_port_id: "signal_start" },
      { x: 4, y: 0, z: 1 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 1, z: 0, pcb_port_id: "signal_end" },
    ],
    vias: [{ x: 4, y: 0 }],
  }
  const fixedRoute: PreloadedHighDensityRoute = {
    connectionName: "fixed",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 3, y: -1, z: 0 },
      { x: 7, y: -1, z: 0 },
    ],
    vias: [],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -6, minY: -6, maxX: 8, maxY: 6 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 6, y: 0, layer: "bottom", pcb_port_id: "signal_start" },
          { x: 4, y: 1, layer: "top", pcb_port_id: "signal_end" },
        ],
      },
      {
        name: "fixed",
        pointsToConnect: [
          { x: 3, y: -1, layer: "top", pcb_port_id: "fixed_start" },
          { x: 7, y: -1, layer: "top", pcb_port_id: "fixed_end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        obstacleId: "pcb_smtpad_1",
        center: { x: 0, y: 0 },
        width: 10,
        height: 10,
        layers: ["bottom"],
        connectedTo: ["foreign"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_1",
          pcb_port_id: "foreign_port",
        },
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed_preload",
        connection_name: "fixed",
        connectsTo: ["fixed_start", "fixed_end"],
        route: [
          { route_type: "wire", x: 3, y: -1, width: 0.15, layer: "top" },
          { route_type: "wire", x: 7, y: -1, width: 0.15, layer: "top" },
        ],
      },
    ],
  }
  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      srj.obstacles.push({
        type: "rect",
        center: { x: point.x, y: point.y },
        width: 0.3,
        height: 0.3,
        layers: [point.layer!],
        connectedTo: [connection.name, point.pcb_port_id!],
        circuitJsonMetadata: {
          pcb_smtpad_id: `pad_${point.pcb_port_id}`,
          pcb_port_id: point.pcb_port_id!,
        },
      })
    }
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const drcEvaluator = createPipeline9RelaxedDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    srjWithPointPairs: srj,
    originalSrj: srj,
    mutatedPreloadedTraces: [],
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const errors = getPipeline9DrcErrors(drcEvaluator, [route])
  const contact = errors.find((error) => error.type === "pcb_trace_error")!
  expect(contact).toBeDefined()
  const center = getRepairCenter(contact, srj)!
  expect(center.x).toBe(5)
  expect(getRepairCenter({ ...contact, center: undefined }, srj)).toEqual({
    x: 0,
    y: 0,
  })
  const fixedBefore = structuredClone(fixedRoute)
  const candidate = preparePipeline9RegionalB01Candidate({
    routes: [route],
    fixedObstacleRoutes: [fixedRoute],
    routeIndex: 0,
    center,
    regionSize: 3,
    srj,
    connMap,
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.1,
    effort: 1,
  })!
  expect(candidate).toBeDefined()
  candidate.solver.solve()
  const result = getPipeline9RegionalB01CandidateOutput(candidate)!
  expect(result).toBeDefined()
  expect(getPipeline9DrcErrors(drcEvaluator, result.routes)).toEqual([])
  expect(fixedRoute).toEqual(fixedBefore)
  expect(result.routes[0]!.route[0]).toEqual(route.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(route.route.at(-1))
  expect(result.routes[0]!.vias.every((via) => via.x >= 5.25)).toBeTrue()
})
