import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator, SimpleRouteJson } from "high-density-repair03/lib"
import { Pipeline9ExactDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-exact-drc-repair-solver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

const terminal = { x: 13.9125, y: -6 }
const terminalPortId = "pcb_port_16"

const srj: SimpleRouteJson = {
  bounds: { minX: 9, minY: -9, maxX: 16, maxY: -3 },
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [
    {
      name: "source_net_1_mst0",
      netConnectionName: "source_net_1",
      pointsToConnect: [
        {
          x: 10,
          y: -8,
          layer: "bottom",
          pointId: "pcb_port_start",
          pcb_port_id: "pcb_port_start",
        },
        {
          ...terminal,
          layer: "bottom",
          pointId: terminalPortId,
          pcb_port_id: terminalPortId,
        },
      ],
    },
  ],
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "preloaded_source_net_1",
      connection_name: "source_net_1",
      route: [
        {
          route_type: "wire",
          x: 15,
          y: -5,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "wire",
          ...terminal,
          width: 0.1,
          layer: "top",
        },
      ],
    },
  ],
}

const terminalPad: Obstacle = {
  type: "rect",
  layers: ["bottom"],
  center: terminal,
  width: 1,
  height: 0.6,
  connectedTo: [
    "pcb_smtpad_16",
    terminalPortId,
    "source_net_1",
    "source_net_1_mst0",
  ],
}

const startPad: Obstacle = {
  type: "rect",
  layers: ["bottom"],
  center: { x: 10, y: -8 },
  width: 1,
  height: 0.6,
  connectedTo: [
    "pcb_smtpad_start",
    "pcb_port_start",
    "source_net_1",
    "source_net_1_mst0",
  ],
}

const route: HighDensityRoute = {
  connectionName: "source_net_1_mst0",
  rootConnectionName: "source_net_1",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  vias: [],
  route: [
    { x: 10, y: -8, z: 1, pcb_port_id: "pcb_port_start" },
    { x: 12, y: -6, z: 1 },
    { ...terminal, z: 1, pcb_port_id: terminalPortId },
  ],
}

const missingConnectionError = {
  type: "pcb_trace_error",
  error_type: "pcb_trace_error",
  pcb_trace_error_id: "missing_connection_combined_source_net_1",
  pcb_trace_id: "source_net_1_mst0_0",
  source_trace_id: "source_net_1",
  candidate_pcb_trace_ids: ["source_net_1_mst0_0"],
  center: terminal,
}

test("Pipeline9 bridges a bottom terminal to same-net preloaded top copper", () => {
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const candidateRoute = routes?.[0]
    const hasTerminalVia =
      candidateRoute?.route.some((point, pointIndex) => {
        const nextPoint = candidateRoute.route[pointIndex + 1]
        return (
          nextPoint !== undefined &&
          point.x === terminal.x &&
          point.y === terminal.y &&
          nextPoint.x === terminal.x &&
          nextPoint.y === terminal.y &&
          point.z !== nextPoint.z
        )
      }) ?? false
    const errors = hasTerminalVia ? [] : [missingConnectionError]
    return { errors, errorsWithCenters: errors }
  }
  const solver = new Pipeline9ExactDrcRepairSolver({
    srj,
    hdRoutes: [route],
    drcEvaluator,
    connMap: new ConnectivityMap({
      connectivity_net16: ["source_net_1", "source_net_1_mst0"],
    }),
    originalObstacles: [startPad, terminalPad],
    ijumpBaseObstacles: [startPad, terminalPad],
    viaHoleDiameter: 0.15,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  const privateSolver = solver as unknown as {
    localCleanupDrcEvaluations: number
    selectedLocalCleanupDrcEvaluationLimit: number
    runFinalContinuityTerminalViaBridge: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    getSnapshot: (routes: HighDensityRoute[]) => {
      count: number
      errors: Array<Record<string, unknown>>
      traceRouteIndexById: Map<string, number>
    }
    getFinalContinuityTerminalViaCandidates: (
      routes: HighDensityRoute[],
      snapshot: {
        count: number
        errors: Array<Record<string, unknown>>
        traceRouteIndexById: Map<string, number>
      },
      error: Record<string, unknown>,
    ) => Array<{
      routeIndex: number
      endpoint: "start" | "end"
      targetZ: number
    }>
    addFinalContinuityTerminalViaStub: (
      route: HighDensityRoute,
      endpoint: "start" | "end",
      targetZ: number,
    ) => HighDensityRoute | undefined
    candidatePreservesTerminals: (routes: HighDensityRoute[]) => boolean
    finalContinuityTerminalViaAttempts: number
    finalContinuityTerminalViaDrcEvaluations: number
    finalContinuityTerminalViaCandidatesAccepted: number
  }
  privateSolver.localCleanupDrcEvaluations = 300
  privateSolver.selectedLocalCleanupDrcEvaluationLimit = 300

  const baselineSnapshot = privateSolver.getSnapshot([route])
  expect(
    privateSolver
      .getFinalContinuityTerminalViaCandidates(
        [route],
        baselineSnapshot,
        baselineSnapshot.errors[0]!,
      )
      .map(({ routeIndex, endpoint, targetZ }) => ({
        routeIndex,
        endpoint,
        targetZ,
      })),
  ).toEqual([{ routeIndex: 0, endpoint: "end", targetZ: 0 }])
  const directBridge = privateSolver.addFinalContinuityTerminalViaStub(
    route,
    "end",
    0,
  )
  expect(directBridge).toBeDefined()
  expect(
    directBridge
      ? privateSolver.candidatePreservesTerminals([directBridge])
      : false,
  ).toBe(true)

  const output = privateSolver.runFinalContinuityTerminalViaBridge([route])
  const outputRoute = output[0]!
  const simplified = convertHdRouteToSimplifiedRoute(outputRoute, 2)
  const layerTransitions = outputRoute.route.flatMap((point, pointIndex) => {
    const nextPoint = outputRoute.route[pointIndex + 1]
    return nextPoint && point.z !== nextPoint.z ? [{ point, nextPoint }] : []
  })

  expect(privateSolver.finalContinuityTerminalViaAttempts).toBe(1)
  expect(privateSolver.finalContinuityTerminalViaDrcEvaluations).toBe(1)
  expect(privateSolver.finalContinuityTerminalViaCandidatesAccepted).toBe(1)
  expect(privateSolver.getSnapshot(output).count).toBe(0)
  expect(outputRoute.route.at(-1)).toMatchObject({
    ...terminal,
    z: 1,
    pcb_port_id: terminalPortId,
  })
  expect(outputRoute.vias).toHaveLength(1)
  expect(outputRoute.vias[0]!.x).toBeCloseTo(terminal.x, 3)
  expect(outputRoute.vias[0]!.y).toBe(terminal.y)
  expect(layerTransitions).toHaveLength(2)
  expect(
    layerTransitions.every(
      ({ point, nextPoint }) =>
        point.x === nextPoint.x && point.y === nextPoint.y,
    ),
  ).toBe(true)
  expect(simplified.filter((segment) => segment.route_type === "via")).toEqual([
    {
      route_type: "via",
      ...terminal,
      from_layer: "bottom",
      to_layer: "top",
      via_diameter: 0.3,
    },
  ])
  expect(privateSolver.localCleanupDrcEvaluations).toBe(300)
})
