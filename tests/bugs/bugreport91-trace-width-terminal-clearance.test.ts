import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const CONNECTION_NAME = "buck_ground"
const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  minTraceToPadEdgeClearance: 0.1,
  bounds: { minX: 14, minY: 8, maxX: 18, maxY: 11 },
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: 14.825, y: 10.5 },
      width: 0.8,
      height: 0.95,
      connectedTo: [CONNECTION_NAME, "pcb_port_182"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pcb_smtpad_154",
        pcb_port_id: "pcb_port_182",
      },
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 16.500001, y: 8.722503 },
      width: 0.2800096,
      height: 0.5450078,
      connectedTo: [CONNECTION_NAME, "pcb_port_190"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pcb_smtpad_162",
        pcb_port_id: "pcb_port_190",
      },
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 16.999873, y: 8.722503 },
      width: 0.2800096,
      height: 0.5450078,
      connectedTo: ["buck_enable", "pcb_port_189"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pcb_smtpad_161",
        pcb_port_id: "pcb_port_189",
      },
    },
  ],
  connections: [
    {
      name: CONNECTION_NAME,
      nominalTraceWidth: 0.6,
      pointsToConnect: [
        {
          x: 14.825,
          y: 10.5,
          layer: "top",
          pcb_port_id: "pcb_port_182",
        },
        {
          x: 16.500001,
          y: 8.722503,
          layer: "top",
          pcb_port_id: "pcb_port_190",
        },
      ],
    },
  ],
}
const hdRoute: HighDensityRoute = {
  connectionName: CONNECTION_NAME,
  rootConnectionName: CONNECTION_NAME,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: 14.825, y: 10.5, z: 0 },
    { x: 14.825, y: 10.397504, z: 0 },
    { x: 16.500001, y: 8.722503, z: 0 },
  ],
  vias: [],
}

test("bugreport91 trace width checks terminal clearance before accepting a width", () => {
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const solver = new TraceWidthSolver({
    hdRoutes: [hdRoute],
    connection: srj.connections,
    obstacles: srj.obstacles,
    connMap,
    minTraceWidth: srj.minTraceWidth,
    obstacleMargin: srj.minTraceToPadEdgeClearance,
    layerCount: srj.layerCount,
  })
  solver.solve()

  const outputHdRoutes = solver.getHdRoutesWithWidths()
  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: srj.connections,
    originalConnections: srj.connections,
    hdRoutes: outputHdRoutes,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const { errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces,
  })

  expect(solver.solved).toBe(true)
  expect(outputHdRoutes[0]!.traceThickness).toBeLessThan(0.6)
  expect(
    errors.filter((error) => error.type === "pcb_pad_trace_clearance_error"),
  ).toHaveLength(0)
})
