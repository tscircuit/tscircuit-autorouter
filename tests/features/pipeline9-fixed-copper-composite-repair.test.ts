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
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-b01-rerouter"

const srj: SimpleRouteJson = {
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: ["A", "B"].map((name, index) => ({
    name,
    pointsToConnect: [
      {
        x: -1,
        y: index * 0.5,
        layer: "top",
        pointId: `${name}_start`,
      },
      {
        x: 1,
        y: index * 0.5,
        layer: "top",
        pointId: `${name}_end`,
      },
    ],
  })),
}

const hdRoutes: HighDensityRoute[] = ["A", "B"].map(
  (connectionName, index) => ({
    connectionName,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      {
        x: -1,
        y: index * 0.5,
        z: 0,
        pcb_port_id: `${connectionName}_start`,
      },
      {
        x: 1,
        y: index * 0.5,
        z: 0,
        pcb_port_id: `${connectionName}_end`,
      },
    ],
  }),
)

test("Pipeline9 atomically repairs a fixed-copper escape and its newly exposed owner", () => {
  let sawWorseIntermediate = false
  const fixedError = {
    type: "pcb_trace_error",
    error_type: "pcb_trace_error",
    pcb_trace_id: "preloaded_0_fixed_trace",
    pcb_trace_error_id: "overlap_preloaded_0_fixed_trace_A_0",
    candidate_pcb_trace_ids: ["A_0"],
    center: { x: 0, y: 0 },
  }
  const exposedErrors = [
    {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      pcb_trace_id: "B_0",
      pcb_trace_error_id: "overlap_B_0_A_0",
      candidate_pcb_trace_ids: ["B_0", "A_0"],
      center: { x: 0.25, y: 0.25 },
    },
    {
      type: "pcb_via_trace_clearance_error",
      error_type: "pcb_via_trace_clearance_error",
      pcb_via_trace_clearance_error_id: "clearance_B_0_A_0",
      pcb_trace_id: "B_0",
      candidate_pcb_trace_ids: ["B_0", "A_0"],
      center: { x: 0.5, y: 0.25 },
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    if (routes?.[0]?.rootConnectionName !== "fixed-only-primary") {
      return { errors: [fixedError], errorsWithCenters: [fixedError] }
    }
    if (routes[1]?.rootConnectionName !== "candidate-aware-followup") {
      sawWorseIntermediate = true
      return { errors: exposedErrors, errorsWithCenters: exposedErrors }
    }
    return []
  }
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
    includeCandidateCopper: boolean
    shortenPath: boolean
  }> = []
  const stubRerouter = {
    tryReroute: (
      routes: HighDensityRoute[],
      options: Pipeline9B01RerouteOptions,
    ): Pipeline9B01RerouteResult | undefined => {
      attempts.push({
        routeIndex: options.routeIndex,
        includeCandidateCopper: options.includeCandidateCopper,
        shortenPath: options.shortenPath,
      })
      const targetRoute = routes[options.routeIndex]
      if (!targetRoute) return undefined

      if (
        options.routeIndex === 0 &&
        !options.includeCandidateCopper &&
        options.shortenPath
      ) {
        return {
          route: {
            ...targetRoute,
            rootConnectionName: "fixed-only-primary",
          },
          iterations: 300,
        }
      }
      if (
        options.routeIndex === 1 &&
        options.includeCandidateCopper &&
        routes[0]?.rootConnectionName === "fixed-only-primary"
      ) {
        return {
          route: {
            ...targetRoute,
            rootConnectionName: "candidate-aware-followup",
          },
          iterations: 200,
        }
      }
      return { iterations: 50 }
    },
  }
  const privateSolver = solver as unknown as {
    b01Rerouter: typeof stubRerouter
    runFixedCopperCompositeRepair: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    getSnapshot: (routes: HighDensityRoute[]) => { count: number }
    fixedCopperCompositePrimaryAttempts: number
    fixedCopperCompositeFollowupAttempts: number
    fixedCopperCompositeDrcEvaluations: number
    fixedCopperCompositeCandidatesAccepted: number
    fixedCopperCompositeIterations: number
  }
  privateSolver.b01Rerouter = stubRerouter

  expect(privateSolver.getSnapshot(hdRoutes).count).toBe(1)
  const output = privateSolver.runFixedCopperCompositeRepair(hdRoutes)

  expect(sawWorseIntermediate).toBe(true)
  expect(privateSolver.getSnapshot(output).count).toBe(0)
  expect(output[0]?.rootConnectionName).toBe("fixed-only-primary")
  expect(output[1]?.rootConnectionName).toBe("candidate-aware-followup")
  expect(attempts).toEqual([
    {
      routeIndex: 0,
      includeCandidateCopper: false,
      shortenPath: true,
    },
    {
      routeIndex: 1,
      includeCandidateCopper: true,
      shortenPath: false,
    },
  ])
  expect(privateSolver.fixedCopperCompositePrimaryAttempts).toBe(1)
  expect(privateSolver.fixedCopperCompositeFollowupAttempts).toBe(1)
  expect(privateSolver.fixedCopperCompositeDrcEvaluations).toBe(2)
  expect(privateSolver.fixedCopperCompositeCandidatesAccepted).toBe(1)
  expect(privateSolver.fixedCopperCompositeIterations).toBe(500)
  expect(output[0]?.route[0]).toEqual(hdRoutes[0]?.route[0])
  expect(output[0]?.route.at(-1)).toEqual(hdRoutes[0]?.route.at(-1))
  expect(output[1]?.route[0]).toEqual(hdRoutes[1]?.route[0])
  expect(output[1]?.route.at(-1)).toEqual(hdRoutes[1]?.route.at(-1))
})
