import { checkViaPadClearance } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

const RF_CONNECTION = "source_trace_110_fixed_3_0"
const GROUND_CONNECTION = "source_net_0_mst85"

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_109",
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
      rootConnectionName: "connectivity_net1",
    },
    {
      portPointId: "ground:end",
      prevPortPointId: "ground:start",
      x: 7.367499,
      y: -0.68,
      z: 0,
      connectionName: GROUND_CONNECTION,
      rootConnectionName: "connectivity_net1",
    },
    {
      portPointId: "rf:start",
      nextPortPointId: "rf:end",
      x: 6.915,
      y: 0,
      z: 0,
      connectionName: RF_CONNECTION,
      rootConnectionName: "connectivity_net31",
    },
    {
      portPointId: "rf:end",
      prevPortPointId: "rf:start",
      x: 7.77,
      y: -0.68,
      z: 0,
      connectionName: RF_CONNECTION,
      rootConnectionName: "connectivity_net31",
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
  qfnPad({ id: "pcb_smtpad_27", y: -0.8, net: "p0_23" }),
  qfnPad({ id: "pcb_smtpad_28", y: -0.4, net: "p0_24" }),
  qfnPad({ id: "pcb_smtpad_29", y: 0, net: "connectivity_net31" }),
  qfnPad({ id: "pcb_smtpad_30", y: 0.4, net: "connectivity_net1" }),
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
      rootConnectionName: "connectivity_net1",
      pointsToConnect: [
        { x: 7.47568, y: 0.4879989, layer: "top" },
        { x: 7.367499, y: -0.68, layer: "top" },
      ],
    },
    {
      name: RF_CONNECTION,
      rootConnectionName: "connectivity_net31",
      pointsToConnect: [
        { x: 6.915, y: 0, layer: "top" },
        { x: 7.77, y: -0.68, layer: "top" },
      ],
    },
  ],
}
const connMap = getConnectivityMapFromSimpleRouteJson(srj)

const createSolver = (
  validatePreloadedVias: boolean,
): Pipeline9RegionalFallbackSolver =>
  new Pipeline9RegionalFallbackSolver({
    nodeWithPortPoints,
    colorMap: {
      [GROUND_CONNECTION]: "#2563eb",
      [RF_CONNECTION]: "#dc2626",
    },
    connMap,
    viaDiameter: 0.6,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles,
    ...(validatePreloadedVias
      ? {
          boardObstacles: obstacles,
          movablePreloadedConnectionNames: new Set([RF_CONNECTION]),
          viaToPadClearance: 0.1,
        }
      : {}),
    layerCount: 4,
  })

const toTraces = (routes: HighDensityRoute[]): SimplifiedPcbTrace[] =>
  routes.map((route) => ({
    type: "pcb_trace",
    pcb_trace_id: `trace_${route.connectionName}`,
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, 4, {
      defaultViaHoleDiameter: 0.3,
    }),
  }))

const getViaPadErrors = (
  traces: SimplifiedPcbTrace[],
): ReturnType<typeof checkViaPadClearance> => {
  const drc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: traces,
  })
  return checkViaPadClearance(drc.circuitJson, { minClearance: 0.1 })
}

const cleanPreloadedTrace: SimplifiedPcbTrace = {
  type: "pcb_trace",
  pcb_trace_id: "trace_preloaded_rf",
  connection_name: RF_CONNECTION,
  route: [
    { route_type: "wire", x: 6.915, y: 0, width: 0.1, layer: "top" },
    { route_type: "wire", x: 7.77, y: -0.68, width: 0.1, layer: "top" },
  ],
}

test("bugreport100 rejects a movable preloaded via beside a foreign QFN pad", async () => {
  const legacySolver = createSolver(false)
  legacySolver.solve()
  expect(legacySolver.failed).toBe(false)
  const legacyTraces = toTraces(legacySolver.getOutput())
  const legacyRfTrace = legacyTraces.find(
    (trace) => trace.connection_name === RF_CONNECTION,
  )!
  const legacyViaPadErrors = getViaPadErrors([legacyRfTrace])

  const fixedSolver = createSolver(true)
  fixedSolver.solve()
  expect(fixedSolver.failed).toBe(false)
  const fixedTraces = toTraces(fixedSolver.getOutput())
  const fixedRfTrace = fixedTraces.find(
    (trace) => trace.connection_name === RF_CONNECTION,
  )!
  const fixedViaPadErrors = getViaPadErrors([fixedRfTrace])

  expect(legacyViaPadErrors).toContainEqual(
    expect.objectContaining({
      pcb_pad_ids: expect.arrayContaining(["pcb_smtpad_30"]),
    }),
  )
  expect(fixedSolver.stats.preloadedViaCandidateRejectionCount).toBe(1)
  expect(fixedSolver.highDensitySolver.stats.highDensityResizeCount).toBe(1)
  expect(
    fixedRfTrace.route.filter((point) => point.route_type === "via"),
  ).toEqual([])
  expect(fixedViaPadErrors).toEqual([])

  const frames = [
    { name: "PRELOADED · CLEAN RF", traces: [cleanPreloadedTrace] },
    { name: "OLD FALLBACK · VIA / FOREIGN PAD DRC", traces: [legacyRfTrace] },
    { name: "FIXED FALLBACK · REJECTED VIA", traces: [fixedRfTrace] },
  ].map(({ name, traces }) => ({
    name,
    graphics: convertSrjToGraphicsObject(
      { ...srj, traces },
      { traceColorMode: "layer" },
    ),
  }))
  await expect(
    getGraphicsSvgFrames({ frames, columns: 3, backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
