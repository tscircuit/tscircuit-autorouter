import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  DrcEvaluator,
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"
import { Pipeline9ExactDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-exact-drc-repair-solver"
import type { Obstacle } from "lib/types"

const terminal = { x: -15.85, y: -14.175 }
const foreignPadCenter = { x: -15.81, y: -15 }
const sharedPortId = "pcb_port_76"
const clearTerminalY = terminal.y + 0.07

const srj: SimpleRouteJson = {
  bounds: { minX: -18, minY: -18, maxX: -12, maxY: -11 },
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [
    {
      name: "source_net_33_mst0",
      pointsToConnect: [
        {
          ...terminal,
          layer: "top",
          pointId: sharedPortId,
          pcb_port_id: sharedPortId,
        },
        {
          x: -13,
          y: -13,
          layer: "top",
          pointId: "branch_0_end",
        },
      ],
    },
    {
      name: "source_net_33_mst1",
      pointsToConnect: [
        {
          x: -13,
          y: -14,
          layer: "top",
          pointId: "branch_1_start",
        },
        {
          ...terminal,
          layer: "top",
          pointId: sharedPortId,
          pcb_port_id: sharedPortId,
        },
      ],
    },
  ],
}

const ownPad: Obstacle = {
  type: "rect",
  layers: ["top"],
  center: { x: -15.85, y: -14.175 },
  width: 1,
  height: 0.6,
  connectedTo: [
    "pcb_smtpad_76",
    sharedPortId,
    "source_net_33",
    "source_net_33_mst0",
    "source_net_33_mst1",
  ],
}

const foreignPad: Obstacle = {
  type: "rect",
  layers: ["top", "bottom"],
  center: foreignPadCenter,
  width: 1.5,
  height: 1.5,
  connectedTo: ["pcb_plated_hole_24", "foreign_net"],
}

const hdRoutes: HighDensityRoute[] = [
  {
    connectionName: "source_net_33_mst0",
    rootConnectionName: "source_net_33",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { ...terminal, z: 0, pcb_port_id: sharedPortId },
      { x: -15, y: -13.7, z: 0 },
      { x: -13, y: -13, z: 0, pcb_port_id: "branch_0_end" },
    ],
  },
  {
    connectionName: "source_net_33_mst1",
    rootConnectionName: "source_net_33",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -13, y: -14, z: 0, pcb_port_id: "branch_1_start" },
      { x: -15, y: -13.8, z: 0 },
      { ...terminal, z: 0, pcb_port_id: sharedPortId },
    ],
  },
]

const makePadTraceError = (traceId: string) => ({
  type: "pcb_pad_trace_clearance_error",
  error_type: "pcb_pad_trace_clearance_error",
  pcb_trace_id: traceId,
  pcb_pad_id: "pcb_plated_hole_24",
  pcb_pad_trace_clearance_error_id: `clearance_${traceId}_pcb_plated_hole_24`,
  candidate_pcb_trace_ids: [traceId],
  center: foreignPadCenter,
})

test("Pipeline9 atomically slides a shared terminal after local cleanup is exhausted", () => {
  const evaluatedTerminalPairs: Array<{
    branch0: { x: number; y: number }
    branch1: { x: number; y: number }
  }> = []
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const branch0 = routes?.[0]?.route[0] ?? terminal
    const branch1 = routes?.[1]?.route.at(-1) ?? terminal
    evaluatedTerminalPairs.push({
      branch0: { x: branch0.x, y: branch0.y },
      branch1: { x: branch1.x, y: branch1.y },
    })
    const errors = [
      ...(branch0.y < clearTerminalY
        ? [makePadTraceError("source_net_33_mst0_0")]
        : []),
      ...(branch1.y < clearTerminalY
        ? [makePadTraceError("source_net_33_mst1_0")]
        : []),
    ]
    return { errors, errorsWithCenters: errors }
  }
  const solver = new Pipeline9ExactDrcRepairSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    connMap: new ConnectivityMap({
      source_net_33: ["source_net_33_mst0", "source_net_33_mst1"],
      foreign_net: ["foreign_net"],
    }),
    originalObstacles: [ownPad, foreignPad],
    b01BaseObstacles: [ownPad, foreignPad],
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
    runFinalEndpointSlideCleanup: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    getSnapshot: (routes: HighDensityRoute[]) => { count: number }
    finalEndpointSlideAttempts: number
    finalEndpointSlideDrcEvaluations: number
    finalEndpointSlideCandidatesAccepted: number
    finalEndpointSlideRelocatedBranches: number
  }
  privateSolver.localCleanupDrcEvaluations = 300
  privateSolver.selectedLocalCleanupDrcEvaluationLimit = 300

  const output = privateSolver.runFinalEndpointSlideCleanup(hdRoutes)

  expect(privateSolver.getSnapshot(output).count).toBe(0)
  expect(output[0]!.route[0]!.y).toBeGreaterThanOrEqual(clearTerminalY)
  expect(output[1]!.route.at(-1)!.y).toBe(output[0]!.route[0]!.y)
  expect(output[1]!.route.at(-1)!.x).toBe(output[0]!.route[0]!.x)
  expect(
    evaluatedTerminalPairs.every(
      ({ branch0, branch1 }) =>
        branch0.x === branch1.x && branch0.y === branch1.y,
    ),
  ).toBe(true)
  expect(privateSolver.localCleanupDrcEvaluations).toBe(300)
  expect(privateSolver.finalEndpointSlideAttempts).toBeGreaterThan(0)
  expect(privateSolver.finalEndpointSlideDrcEvaluations).toBeLessThanOrEqual(32)
  expect(privateSolver.finalEndpointSlideCandidatesAccepted).toBe(1)
  expect(privateSolver.finalEndpointSlideRelocatedBranches).toBe(2)
})
