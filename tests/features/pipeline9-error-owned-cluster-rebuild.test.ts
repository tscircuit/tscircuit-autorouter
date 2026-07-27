import { expect, test } from "bun:test"
import type {
  DrcEvaluator,
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"
import { Pipeline9ExactDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-exact-drc-repair-solver"
import type {
  Pipeline9B01RerouteOptions,
  Pipeline9B01RerouteResult,
  Pipeline9TerminalViaEscapeOptions,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-b01-rerouter"

const srj: SimpleRouteJson = {
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: ["A", "B", "C"].map((name, index) => ({
    name,
    pointsToConnect: [
      { x: -1, y: index - 1, layer: "top", pointId: `${name}_start` },
      { x: 1, y: index - 1, layer: "top", pointId: `${name}_end` },
    ],
  })),
}

const hdRoutes: HighDensityRoute[] = ["A", "B", "C"].map(
  (connectionName, index) => ({
    connectionName,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      {
        x: -1,
        y: index - 1,
        z: 0,
        pcb_port_id: `${connectionName}_start`,
      },
      {
        x: 1,
        y: index - 1,
        z: 0,
        pcb_port_id: `${connectionName}_end`,
      },
    ],
  }),
)

const drcEvaluator: DrcEvaluator = ({ routes }) => {
  if (routes?.every((route) => route.route.length >= 3)) {
    if ((routes[0]?.route.length ?? 0) >= 4) return []
    const postClusterError = {
      type: "pcb_via_trace_clearance_error",
      error_type: "pcb_via_trace_clearance_error",
      pcb_trace_id: "B_0",
      candidate_pcb_trace_ids: ["A_0"],
      center: { x: 0, y: -0.5 },
    }
    return {
      errors: [postClusterError],
      errorsWithCenters: [postClusterError],
    }
  }
  const errors = [
    {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      pcb_trace_id: "A_0",
      pcb_trace_error_id: "overlap_A_0_B_0",
      candidate_pcb_trace_ids: ["A_0", "B_0"],
      center: { x: 0, y: -0.5 },
    },
    {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      pcb_trace_id: "A_0",
      pcb_trace_error_id: "overlap_A_0_C_0",
      candidate_pcb_trace_ids: ["A_0", "C_0"],
      center: { x: 0, y: 0.5 },
    },
  ]
  return { errors, errorsWithCenters: errors }
}

test("Pipeline9 atomically rebuilds error-owned routes in residual-degree order", () => {
  const solver = new Pipeline9ExactDrcRepairSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    originalObstacles: [],
    b01BaseObstacles: [],
    viaHoleDiameter: 0.15,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  const attempts: Array<{
    routeIndex: number
    omittedRouteIndexes: number[]
    maxIterations: number
  }> = []
  const stubRerouter = {
    tryReroute: (
      routes: HighDensityRoute[],
      options: Pipeline9B01RerouteOptions,
    ): Pipeline9B01RerouteResult | undefined => {
      const target = routes[options.routeIndex]
      const start = target?.route[0]
      const end = target?.route.at(-1)
      if (!target || !start || !end) return undefined
      attempts.push({
        routeIndex: options.routeIndex,
        omittedRouteIndexes: [
          ...(options.omitCandidateRouteIndexes ?? []),
        ].sort((left, right) => left - right),
        maxIterations: options.maxIterations,
      })
      return {
        route: {
          ...target,
          route:
            target.route.length >= 3
              ? [
                  start,
                  {
                    x: -0.2,
                    y: start.y + 0.2,
                    z: start.z,
                    traceThickness: target.traceThickness,
                  },
                  {
                    x: 0.2,
                    y: start.y + 0.2,
                    z: start.z,
                    traceThickness: target.traceThickness,
                  },
                  end,
                ]
              : [
                  start,
                  {
                    x: 0,
                    y: start.y + 0.2,
                    z: start.z,
                    traceThickness: target.traceThickness,
                  },
                  end,
                ],
          vias: [],
        },
        iterations: 100,
      }
    },
  }
  const privateSolver = solver as unknown as {
    b01Rerouter: typeof stubRerouter
    runB01ErrorOwnedClusterRebuild: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    errorOwnedClusterAccepted: number
    errorOwnedClusterIterations: number
  }
  privateSolver.b01Rerouter = stubRerouter

  const output = privateSolver.runB01ErrorOwnedClusterRebuild(hdRoutes)

  expect(output.map((route) => route.route.length)).toEqual([4, 3, 3])
  expect(attempts).toEqual([
    {
      routeIndex: 0,
      omittedRouteIndexes: [1, 2],
      maxIterations: 15_000,
    },
    {
      routeIndex: 1,
      omittedRouteIndexes: [2],
      maxIterations: 15_000,
    },
    {
      routeIndex: 2,
      omittedRouteIndexes: [],
      maxIterations: 15_000,
    },
    {
      routeIndex: 0,
      omittedRouteIndexes: [],
      maxIterations: 15_000,
    },
  ])
  expect(privateSolver.errorOwnedClusterAccepted).toBe(1)
  expect(privateSolver.errorOwnedClusterIterations).toBe(400)
  expect(output[0]?.route[0]).toEqual(hdRoutes[0]?.route[0])
  expect(output[0]?.route.at(-1)).toEqual(hdRoutes[0]?.route.at(-1))
})

test("Pipeline9 falls back to a low-degree-first reverse cluster with a bounded terminal escape", () => {
  const solver = new Pipeline9ExactDrcRepairSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    originalObstacles: [],
    b01BaseObstacles: [],
    viaHoleDiameter: 0.15,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  const routeAttempts: Array<{ routeIndex: number; reverse: boolean }> = []
  const terminalAttempts: number[] = []
  const rebuildRoute = (
    routes: HighDensityRoute[],
    routeIndex: number,
  ): HighDensityRoute | undefined => {
    const target = routes[routeIndex]
    const start = target?.route[0]
    const end = target?.route.at(-1)
    if (!target || !start || !end) return undefined
    return {
      ...target,
      route: [
        start,
        {
          x: 0,
          y: start.y + 0.2,
          z: start.z,
        },
        end,
      ],
      vias: [],
    }
  }
  const stubRerouter = {
    tryReroute: (
      routes: HighDensityRoute[],
      options: Pipeline9B01RerouteOptions,
    ): Pipeline9B01RerouteResult => {
      routeAttempts.push({
        routeIndex: options.routeIndex,
        reverse: options.reverse,
      })
      if (!options.reverse || options.routeIndex === 0) {
        return { iterations: 100 }
      }
      return {
        route: rebuildRoute(routes, options.routeIndex),
        iterations: 100,
      }
    },
    getTerminalViaEscapeCandidates: () => [
      {
        alternateZ: 1,
        startVia: { x: -1, y: -1 },
        endVia: { x: 1, y: -1 },
      },
    ],
    tryRerouteWithTerminalViaEscape: (
      routes: HighDensityRoute[],
      options: Pipeline9TerminalViaEscapeOptions,
    ): Pipeline9B01RerouteResult => {
      terminalAttempts.push(options.routeIndex)
      return {
        route: rebuildRoute(routes, options.routeIndex),
        iterations: 100,
      }
    },
  }
  const privateSolver = solver as unknown as {
    b01Rerouter: typeof stubRerouter
    runB01ErrorOwnedClusterRebuild: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    errorOwnedClusterAccepted: number
    errorOwnedClusterIterations: number
    errorOwnedClusterTerminalEscapeAttempts: number
  }
  privateSolver.b01Rerouter = stubRerouter

  const output = privateSolver.runB01ErrorOwnedClusterRebuild(hdRoutes)

  expect(output.every((route) => route.route.length === 3)).toBe(true)
  expect(routeAttempts.some((attempt) => attempt.reverse)).toBe(true)
  expect(
    routeAttempts
      .filter((attempt) => attempt.reverse)
      .map((attempt) => attempt.routeIndex),
  ).toEqual([2, 1, 0])
  expect(terminalAttempts).toEqual([0])
  expect(privateSolver.errorOwnedClusterAccepted).toBe(1)
  expect(privateSolver.errorOwnedClusterIterations).toBe(700)
  expect(privateSolver.errorOwnedClusterTerminalEscapeAttempts).toBe(1)
})

test.each([
  {
    initialDrcIssueCount: 19,
    expectedLocalLimit: 500,
    expectedConsecutiveMissLimit: 500,
    expectedB01Limit: 300_000,
  },
  {
    initialDrcIssueCount: 20,
    expectedLocalLimit: 150,
    expectedConsecutiveMissLimit: 64,
    expectedB01Limit: 200_000,
  },
])(
  "Pipeline9 selects adaptive cleanup limits for $initialDrcIssueCount initial errors",
  ({
    initialDrcIssueCount,
    expectedLocalLimit,
    expectedConsecutiveMissLimit,
    expectedB01Limit,
  }) => {
    const solver = new Pipeline9ExactDrcRepairSolver({
      srj,
      hdRoutes,
      drcEvaluator,
      originalObstacles: [],
      b01BaseObstacles: [],
      viaHoleDiameter: 0.15,
      maxIterations: 1,
      enableLargeBoardBroadFallback: false,
      enablePostSolveClearanceRelaxation: false,
      broadMaxIterations: 1,
      broadPassMultiplier: 1,
    })
    const privateSolver = solver as unknown as {
      stats: Record<string, unknown>
      localCleanupDrcEvaluations: number
      consecutiveLocalCleanupDrcMisses: number
      b01Iterations: number
      selectedLocalCleanupDrcEvaluationLimit: number
      selectedConsecutiveLocalCleanupDrcMissLimit: number
      selectedB01IterationLimit: number
      selectAdaptiveCleanupLimits: () => void
      hasLocalCleanupBudget: () => boolean
      getRemainingB01Iterations: () => number
    }
    privateSolver.stats = { initialDrcIssueCount }
    privateSolver.selectAdaptiveCleanupLimits()

    expect(privateSolver.selectedLocalCleanupDrcEvaluationLimit).toBe(
      expectedLocalLimit,
    )
    expect(privateSolver.selectedConsecutiveLocalCleanupDrcMissLimit).toBe(
      expectedConsecutiveMissLimit,
    )
    expect(privateSolver.selectedB01IterationLimit).toBe(expectedB01Limit)
    privateSolver.consecutiveLocalCleanupDrcMisses =
      expectedConsecutiveMissLimit
    expect(privateSolver.hasLocalCleanupBudget()).toBe(false)
    privateSolver.b01Iterations = expectedB01Limit - 123
    expect(privateSolver.getRemainingB01Iterations()).toBe(123)
  },
)

test("Pipeline9 bounds consecutive fruitless local DRC evaluations and resets after improvement", () => {
  let reportedIssueCount = 2
  const boundedDrcEvaluator: DrcEvaluator = () => {
    const errors = Array.from({ length: reportedIssueCount }, (_, index) => ({
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      pcb_trace_id: `candidate_${index}`,
    }))
    return { errors, errorsWithCenters: errors }
  }
  const solver = new Pipeline9ExactDrcRepairSolver({
    srj,
    hdRoutes,
    drcEvaluator: boundedDrcEvaluator,
    originalObstacles: [],
    b01BaseObstacles: [],
    viaHoleDiameter: 0.15,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  const privateSolver = solver as unknown as {
    consecutiveLocalCleanupDrcMisses: number
    maxConsecutiveLocalCleanupDrcMisses: number
    selectedLocalCleanupDrcEvaluationLimit: number
    selectedConsecutiveLocalCleanupDrcMissLimit: number
    candidateImprovesSnapshot: (
      routes: HighDensityRoute[],
      currentSnapshot: unknown,
      source: "local",
    ) => boolean
    getSnapshot: (routes: HighDensityRoute[]) => unknown
    hasLocalCleanupBudget: () => boolean
  }
  privateSolver.selectedLocalCleanupDrcEvaluationLimit = 10
  privateSolver.selectedConsecutiveLocalCleanupDrcMissLimit = 2
  const baselineSnapshot = privateSolver.getSnapshot(hdRoutes)

  expect(
    privateSolver.candidateImprovesSnapshot(
      hdRoutes,
      baselineSnapshot,
      "local",
    ),
  ).toBe(false)
  expect(privateSolver.consecutiveLocalCleanupDrcMisses).toBe(1)

  reportedIssueCount = 1
  expect(
    privateSolver.candidateImprovesSnapshot(
      hdRoutes,
      baselineSnapshot,
      "local",
    ),
  ).toBe(true)
  expect(privateSolver.consecutiveLocalCleanupDrcMisses).toBe(0)

  reportedIssueCount = 2
  expect(
    privateSolver.candidateImprovesSnapshot(
      hdRoutes,
      baselineSnapshot,
      "local",
    ),
  ).toBe(false)
  expect(privateSolver.hasLocalCleanupBudget()).toBe(true)
  expect(
    privateSolver.candidateImprovesSnapshot(
      hdRoutes,
      baselineSnapshot,
      "local",
    ),
  ).toBe(false)
  expect(privateSolver.hasLocalCleanupBudget()).toBe(false)
  expect(privateSolver.maxConsecutiveLocalCleanupDrcMisses).toBe(2)
})

test("Pipeline9 reserves a bounded post-cluster via micro-shift sweep after the base local budget", () => {
  const solver = new Pipeline9ExactDrcRepairSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    originalObstacles: [],
    b01BaseObstacles: [],
    viaHoleDiameter: 0.15,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  const privateSolver = solver as unknown as {
    localCleanupDrcEvaluations: number
    consecutiveLocalCleanupDrcMisses: number
    selectedLocalCleanupDrcEvaluationLimit: number
    selectedConsecutiveLocalCleanupDrcMissLimit: number
    postClusterViaMicroShiftDrcEvaluations: number
    hasLocalCleanupBudget: () => boolean
    runViaMicroShiftCleanup: (routes: HighDensityRoute[]) => HighDensityRoute[]
    runPostClusterViaMicroShiftCleanup: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
  }
  privateSolver.selectedLocalCleanupDrcEvaluationLimit = 300
  privateSolver.localCleanupDrcEvaluations = 300
  privateSolver.selectedConsecutiveLocalCleanupDrcMissLimit = 64
  privateSolver.consecutiveLocalCleanupDrcMisses = 64
  privateSolver.runViaMicroShiftCleanup = (routes) => {
    expect(privateSolver.hasLocalCleanupBudget()).toBe(true)
    privateSolver.localCleanupDrcEvaluations += 32
    return routes
  }

  const output = privateSolver.runPostClusterViaMicroShiftCleanup(hdRoutes)

  expect(output).toBe(hdRoutes)
  expect(privateSolver.postClusterViaMicroShiftDrcEvaluations).toBe(32)
  expect(privateSolver.selectedLocalCleanupDrcEvaluationLimit).toBe(300)
  expect(privateSolver.consecutiveLocalCleanupDrcMisses).toBe(64)
  expect(privateSolver.hasLocalCleanupBudget()).toBe(false)
})
