import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  DrcEvaluator,
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"
import { Pipeline9ExactDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-exact-drc-repair-solver"
import type {
  Pipeline9IjumpRerouteOptions,
  Pipeline9IjumpRerouteResult,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-ijump-rerouter"
import type { Obstacle } from "lib/types"

const srj: SimpleRouteJson = {
  bounds: { minX: -1, minY: -1, maxX: 3, maxY: 2 },
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [
    {
      name: "branchA",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pointId: "shared_port" },
        { x: 2, y: 0, layer: "bottom", pointId: "branch_a_end" },
      ],
    },
    {
      name: "branchB",
      pointsToConnect: [
        { x: 2, y: 1, layer: "bottom", pointId: "branch_b_start" },
        { x: 0, y: 0, layer: "top", pointId: "shared_port" },
      ],
    },
    {
      name: "blocker",
      pointsToConnect: [
        { x: -0.5, y: 0.5, layer: "top", pointId: "blocker_start" },
        { x: 2.5, y: 0.5, layer: "top", pointId: "blocker_end" },
      ],
    },
  ],
}

const sharedPad: Obstacle = {
  type: "rect",
  layers: ["top"],
  center: { x: 0, y: 0 },
  width: 1,
  height: 1,
  connectedTo: ["pcb_smtpad_shared", "shared_port", "branchA", "branchB"],
}

const hdRoutes: HighDensityRoute[] = [
  {
    connectionName: "branchA",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x: 0.8, y: 0 }],
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "shared_port" },
      { x: 0.8, y: 0, z: 0 },
      { x: 0.8, y: 0, z: 1 },
      { x: 2, y: 0, z: 1, pcb_port_id: "branch_a_end" },
    ],
  },
  {
    connectionName: "branchB",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x: 0.8, y: 1 }],
    route: [
      { x: 2, y: 1, z: 1, pcb_port_id: "branch_b_start" },
      { x: 0.8, y: 1, z: 1 },
      { x: 0.8, y: 1, z: 0 },
      { x: 0, y: 0, z: 0, pcb_port_id: "shared_port" },
    ],
  },
  {
    connectionName: "blocker",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -0.5, y: 0.5, z: 0, pcb_port_id: "blocker_start" },
      { x: 2.5, y: 0.5, z: 0, pcb_port_id: "blocker_end" },
    ],
  },
]

const makeTraceError = (
  primaryTraceId: string,
  otherTraceId: string,
  candidateTraceId: string,
) => ({
  type: "pcb_trace_error",
  error_type: "pcb_trace_error",
  pcb_trace_id: primaryTraceId,
  pcb_trace_error_id: `overlap_${primaryTraceId}_${otherTraceId}`,
  candidate_pcb_trace_ids: [candidateTraceId],
  center: { x: 0.25, y: 0.25 },
})

const transitionIsAtSharedTerminal = (
  route: HighDensityRoute | undefined,
): boolean =>
  Boolean(
    route?.route.some(
      (point, pointIndex) =>
        point.x === 0 &&
        point.y === 0 &&
        route.route[pointIndex + 1]?.x === 0 &&
        route.route[pointIndex + 1]?.y === 0 &&
        route.route[pointIndex + 1]?.z !== point.z,
    ),
  )

const drcEvaluator: DrcEvaluator = ({ routes }) => {
  const branchARelocated = transitionIsAtSharedTerminal(routes?.[0])
  const branchBRelocated = transitionIsAtSharedTerminal(routes?.[1])
  if (!branchARelocated || !branchBRelocated) {
    const errors = [
      makeTraceError("preloaded_fixed_0", "branchA_0", "branchA_0"),
      makeTraceError("preloaded_fixed_0", "branchB_0", "branchB_0"),
    ]
    return { errors, errorsWithCenters: errors }
  }
  if (routes?.[2]?.rootConnectionName === "repaired") return []

  const errors = [
    makeTraceError("blocker_0", "branchA_0", "blocker_0"),
    makeTraceError("blocker_0", "branchB_0", "blocker_0"),
  ]
  return { errors, errorsWithCenters: errors }
}

const makeSolver = () =>
  new Pipeline9ExactDrcRepairSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    connMap: new ConnectivityMap({
      branch_net: ["branchA", "branchB"],
      blocker_net: ["blocker"],
    }),
    originalObstacles: [sharedPad],
    ijumpBaseObstacles: [sharedPad],
    viaHoleDiameter: 0.15,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })

test("Pipeline9 atomically relocates shared-terminal vias and reroutes the exposed owner", () => {
  const solver = makeSolver()
  const attempts: Pipeline9IjumpRerouteOptions[] = []
  const stubRerouter = {
    tryReroute: (
      routes: HighDensityRoute[],
      options: Pipeline9IjumpRerouteOptions,
    ): Pipeline9IjumpRerouteResult => {
      attempts.push({ ...options })
      return {
        route: {
          ...routes[options.routeIndex]!,
          rootConnectionName: "repaired",
        },
        iterations: 2_181,
      }
    },
  }
  const privateSolver = solver as unknown as {
    ijumpRerouter: typeof stubRerouter
    runSharedTerminalCompositeRepair: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    getSnapshot: (routes: HighDensityRoute[]) => { count: number }
    sharedTerminalCompositeAttempts: number
    sharedTerminalCompositeRelocatedBranches: number
    sharedTerminalCompositeIjumpAttempts: number
    sharedTerminalCompositeDrcEvaluations: number
    sharedTerminalCompositeCandidatesAccepted: number
    sharedTerminalCompositeIterations: number
  }
  privateSolver.ijumpRerouter = stubRerouter

  const output = privateSolver.runSharedTerminalCompositeRepair(hdRoutes)

  expect(privateSolver.getSnapshot(output).count).toBe(0)
  expect(transitionIsAtSharedTerminal(output[0])).toBe(true)
  expect(transitionIsAtSharedTerminal(output[1])).toBe(true)
  expect(attempts).toEqual([
    {
      routeIndex: 2,
      includeCandidateCopper: true,
      reverse: false,
      shortenPath: false,
      maxIterations: 12_500,
    },
  ])
  expect(privateSolver.sharedTerminalCompositeAttempts).toBe(1)
  expect(privateSolver.sharedTerminalCompositeRelocatedBranches).toBe(2)
  expect(privateSolver.sharedTerminalCompositeIjumpAttempts).toBe(1)
  expect(privateSolver.sharedTerminalCompositeDrcEvaluations).toBe(2)
  expect(privateSolver.sharedTerminalCompositeCandidatesAccepted).toBe(1)
  expect(privateSolver.sharedTerminalCompositeIterations).toBe(2_181)
})

test("Pipeline9 rolls back a shared-terminal composite that exhausts its hard budget", () => {
  const solver = makeSolver()
  const stubRerouter = {
    tryReroute: (): Pipeline9IjumpRerouteResult => ({ iterations: 12_500 }),
  }
  const privateSolver = solver as unknown as {
    ijumpRerouter: typeof stubRerouter
    runSharedTerminalCompositeRepair: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    sharedTerminalCompositeCandidatesAccepted: number
    sharedTerminalCompositeIterations: number
  }
  privateSolver.ijumpRerouter = stubRerouter

  const output = privateSolver.runSharedTerminalCompositeRepair(hdRoutes)

  expect(output).toBe(hdRoutes)
  expect(privateSolver.sharedTerminalCompositeCandidatesAccepted).toBe(0)
  expect(privateSolver.sharedTerminalCompositeIterations).toBe(12_500)
})
