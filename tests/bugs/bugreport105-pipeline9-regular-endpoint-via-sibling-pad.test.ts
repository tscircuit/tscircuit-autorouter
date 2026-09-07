import { checkViaPadClearance } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const RF_CONNECTION = "source_trace_rf"
const GROUND_CONNECTION = "source_trace_ground"

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_qfn_escape",
  center: { x: 7.561767, y: -0.0960005 },
  width: 1.293534,
  height: 1.167999,
  portPoints: [
    {
      portPointId: "ground:start",
      nextPortPointId: "ground:end",
      x: 7.47568,
      y: 0.4879989,
      z: 0,
      connectionName: GROUND_CONNECTION,
      rootConnectionName: "ground_net",
    },
    {
      portPointId: "ground:end",
      prevPortPointId: "ground:start",
      x: 7.367499,
      y: -0.68,
      z: 0,
      connectionName: GROUND_CONNECTION,
      rootConnectionName: "ground_net",
    },
    {
      portPointId: "rf:start",
      nextPortPointId: "rf:end",
      x: 6.915,
      y: 0,
      z: 0,
      connectionName: RF_CONNECTION,
      rootConnectionName: "rf_net",
    },
    {
      portPointId: "rf:end",
      prevPortPointId: "rf:start",
      x: 7.77,
      y: -0.68,
      z: 0,
      connectionName: RF_CONNECTION,
      rootConnectionName: "rf_net",
    },
  ],
  portPointsInPairs: [],
  availableZ: [0, 1, 2, 3],
}
nodeWithPortPoints.portPointsInPairs = [
  [nodeWithPortPoints.portPoints[0]!, nodeWithPortPoints.portPoints[1]!],
  [nodeWithPortPoints.portPoints[2]!, nodeWithPortPoints.portPoints[3]!],
]

const qfnPad = ({
  id,
  y,
  net,
}: {
  id: string
  y: number
  net: string
}): Obstacle => ({
  type: "rect",
  layers: ["top"],
  center: { x: 6.44, y },
  width: 0.95,
  height: 0.2,
  connectedTo: [id, net],
  circuitJsonMetadata: { pcb_smtpad_id: id },
})

const obstacles: Obstacle[] = [
  qfnPad({ id: "pcb_smtpad_27", y: -0.8, net: "unused_23" }),
  qfnPad({ id: "pcb_smtpad_28", y: -0.4, net: "unused_24" }),
  qfnPad({ id: "pcb_smtpad_29", y: 0, net: "rf_net" }),
  qfnPad({ id: "pcb_smtpad_30", y: 0.4, net: "ground_net" }),
]

const srj: SimpleRouteJson = {
  layerCount: 4,
  minTraceWidth: 0.1,
  minTraceToPadEdgeClearance: 0.05,
  minViaDiameter: 0.6,
  minViaHoleDiameter: 0.3,
  minViaEdgeToPadEdgeClearance: 0.1,
  defaultObstacleMargin: 0.15,
  bounds: { minX: 5.8, minY: -1.5, maxX: 8.5, maxY: 0.8 },
  obstacles,
  connections: [
    {
      name: GROUND_CONNECTION,
      rootConnectionName: "ground_net",
      pointsToConnect: [
        { x: 7.47568, y: 0.4879989, layer: "top" },
        { x: 7.367499, y: -0.68, layer: "top" },
      ],
    },
    {
      name: RF_CONNECTION,
      rootConnectionName: "rf_net",
      pointsToConnect: [
        { x: 6.915, y: 0, layer: "top" },
        { x: 7.77, y: -0.68, layer: "top" },
      ],
    },
  ],
}

test("bugreport105 regular Pipeline9 node keeps endpoint vias clear of sibling pads", () => {
  const solver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    colorMap: {},
    viaDiameter: 0.6,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: new Map(),
    obstacles,
    boardObstacles: obstacles,
    viaToPadClearance: 0.1,
    layerCount: 4,
  })
  solver.solve()
  expect(solver.failed).toBe(false)

  const routedTraces = solver.routes.map((route: HighDensityRoute, index) => ({
    type: "pcb_trace" as const,
    pcb_trace_id: `pcb_trace_${index}`,
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, 4, {
      defaultViaHoleDiameter: 0.3,
    }),
  }))
  const drc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces,
  })

  expect(
    checkViaPadClearance(drc.circuitJson, { minClearance: 0.1 }),
  ).not.toContainEqual(
    expect.objectContaining({
      pcb_pad_ids: expect.arrayContaining(["pcb_smtpad_30"]),
    }),
  )
})
