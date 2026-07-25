import { expect, test } from "bun:test"
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

const makeSrj = (names: string[]): SimpleRouteJson => ({
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: names.map((name, index) => ({
    name,
    pointsToConnect: [
      { x: -1, y: index * 0.5, layer: "top", pointId: `${name}_start` },
      { x: 1, y: index * 0.5, layer: "top", pointId: `${name}_end` },
    ],
  })),
})

const makeSolver = (
  srj: SimpleRouteJson,
  hdRoutes: HighDensityRoute[],
  drcEvaluator: DrcEvaluator,
) =>
  new Pipeline9ExactDrcRepairSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    originalObstacles: [],
    ijumpBaseObstacles: [],
    viaHoleDiameter: 0.15,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })

const makeError = (traceId: string, center: { x: number; y: number }) => ({
  type: "pcb_trace_error",
  error_type: "pcb_trace_error",
  pcb_trace_id: traceId,
  pcb_trace_error_id: `overlap_${traceId}_fixed_trace`,
  candidate_pcb_trace_ids: [traceId],
  center,
})

test("Pipeline9 final-owner sweep handles a 1,046-iteration single owner", () => {
  const srj = makeSrj(["A"])
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 0, z: 0, pcb_port_id: "A_start" },
        { x: 1, y: 0, z: 0, pcb_port_id: "A_end" },
      ],
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    if ((routes?.[0]?.route.length ?? 0) >= 3) return []
    const error = makeError("A_0", { x: 0, y: 0 })
    return { errors: [error], errorsWithCenters: [error] }
  }
  const solver = makeSolver(srj, hdRoutes, drcEvaluator)
  const stubRerouter = {
    tryReroute: (
      routes: HighDensityRoute[],
      options: Pipeline9IjumpRerouteOptions,
    ): Pipeline9IjumpRerouteResult => {
      const target = routes[options.routeIndex]!
      return {
        route: {
          ...target,
          route: [
            target.route[0]!,
            { x: 0, y: 0.2, z: 0 },
            target.route.at(-1)!,
          ],
        },
        iterations: 1_046,
      }
    },
  }
  const privateSolver = solver as unknown as {
    ijumpRerouter: typeof stubRerouter
    runIjumpFinalErrorOwnerSweep: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    finalOwnerFullAttempts: number
    finalOwnerCandidatesAccepted: number
    finalOwnerIterations: number
  }
  privateSolver.ijumpRerouter = stubRerouter

  const output = privateSolver.runIjumpFinalErrorOwnerSweep(hdRoutes)

  expect(drcEvaluator({ traces: [], routes: output })).toEqual([])
  expect(privateSolver.finalOwnerFullAttempts).toBe(1)
  expect(privateSolver.finalOwnerCandidatesAccepted).toBe(1)
  expect(privateSolver.finalOwnerIterations).toBe(1_046)
})

test("Pipeline9 recomputes final owners and falls back to a nearest-error interior window", () => {
  const srj = makeSrj(["A", "B"])
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 0, z: 0, pcb_port_id: "A_start" },
        { x: 1, y: 0, z: 0, pcb_port_id: "A_end" },
      ],
    },
    {
      connectionName: "B",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 0.5, z: 0, pcb_port_id: "B_start" },
        { x: -0.25, y: 0.4, z: 0 },
        { x: 0.25, y: 0.4, z: 0 },
        { x: 1, y: 0.5, z: 0, pcb_port_id: "B_end" },
      ],
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const errors: Array<Record<string, unknown>> = []
    if ((routes?.[0]?.route.length ?? 0) < 3) {
      errors.push(makeError("A_0", { x: 0, y: 0 }))
    }
    if (
      !routes?.[1]?.route.some((point) => point.y > 0.9 && !point.pcb_port_id)
    ) {
      errors.push(makeError("B_0", { x: 0, y: 0.4 }))
    }
    return errors.length === 0 ? [] : { errors, errorsWithCenters: errors }
  }
  const solver = makeSolver(srj, hdRoutes, drcEvaluator)
  const attemptedRouteIndexes: number[] = []
  const stubRerouter = {
    tryReroute: (
      routes: HighDensityRoute[],
      options: Pipeline9IjumpRerouteOptions,
    ): Pipeline9IjumpRerouteResult => {
      attemptedRouteIndexes.push(options.routeIndex)
      const target = routes[options.routeIndex]!
      if (options.routeIndex === 0) {
        return {
          route: {
            ...target,
            route: [
              target.route[0]!,
              { x: 0, y: 0.2, z: 0 },
              target.route.at(-1)!,
            ],
          },
          iterations: 100,
        }
      }
      if (options.startIndex === undefined) return { iterations: 100 }
      return {
        route: {
          ...target,
          route: [
            target.route[0]!,
            { x: -0.25, y: 1.1, z: 0 },
            { x: 0.25, y: 1.1, z: 0 },
            target.route.at(-1)!,
          ],
        },
        iterations: 100,
      }
    },
  }
  const privateSolver = solver as unknown as {
    ijumpRerouter: typeof stubRerouter
    runIjumpFinalErrorOwnerSweep: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    finalOwnerFullAttempts: number
    finalOwnerInteriorAttempts: number
    finalOwnerCandidatesAccepted: number
  }
  privateSolver.ijumpRerouter = stubRerouter

  const output = privateSolver.runIjumpFinalErrorOwnerSweep(hdRoutes)

  expect(drcEvaluator({ traces: [], routes: output })).toEqual([])
  expect(attemptedRouteIndexes[0]).toBe(0)
  expect(attemptedRouteIndexes.slice(1)).toContain(1)
  expect(privateSolver.finalOwnerFullAttempts).toBe(4)
  expect(privateSolver.finalOwnerInteriorAttempts).toBe(1)
  expect(privateSolver.finalOwnerCandidatesAccepted).toBe(2)
})

test("Pipeline9 retries a failed final owner after accepted copper changes", () => {
  const srj = makeSrj(["A", "B"])
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 0, z: 0, pcb_port_id: "A_start" },
        { x: 1, y: 0, z: 0, pcb_port_id: "A_end" },
      ],
    },
    {
      connectionName: "B",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 0.5, z: 0, pcb_port_id: "B_start" },
        { x: 1, y: 0.5, z: 0, pcb_port_id: "B_end" },
      ],
    },
  ]
  const fixedErrors = ["fixed_0", "fixed_1"].map((traceId, index) => ({
    type: "pcb_trace_error",
    error_type: "pcb_trace_error",
    pcb_trace_id: traceId,
    pcb_trace_error_id: `overlap_${traceId}_preloaded`,
    center: { x: index * 0.1, y: 1.5 },
  }))
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const errors: Array<Record<string, unknown>> = [...fixedErrors]
    if ((routes?.[0]?.route.length ?? 0) < 3) {
      errors.unshift(makeError("A_0", { x: 0, y: 0 }))
    }
    if ((routes?.[1]?.route.length ?? 0) < 3) {
      errors.splice(
        errors.length - fixedErrors.length,
        0,
        makeError("B_0", {
          x: 0,
          y: 0.5,
        }),
      )
    }
    return { errors, errorsWithCenters: errors }
  }
  const solver = makeSolver(srj, hdRoutes, drcEvaluator)
  const rawForwardAttempts: number[] = []
  const stubRerouter = {
    tryReroute: (
      routes: HighDensityRoute[],
      options: Pipeline9IjumpRerouteOptions,
    ): Pipeline9IjumpRerouteResult => {
      if (!options.reverse && !options.shortenPath) {
        rawForwardAttempts.push(options.routeIndex)
      }
      if (options.reverse || options.shortenPath) {
        return { iterations: 10 }
      }
      const target = routes[options.routeIndex]!
      if (options.routeIndex === 0 && (routes[1]?.route.length ?? 0) < 3) {
        return { iterations: 10 }
      }
      return {
        route: {
          ...target,
          route: [
            target.route[0]!,
            { x: 0, y: options.routeIndex === 0 ? 0.2 : 0.8, z: 0 },
            target.route.at(-1)!,
          ],
        },
        iterations: 10,
      }
    },
  }
  const privateSolver = solver as unknown as {
    ijumpRerouter: typeof stubRerouter
    runIjumpFinalErrorOwnerSweep: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    finalOwnerCandidatesAccepted: number
  }
  privateSolver.ijumpRerouter = stubRerouter

  const output = privateSolver.runIjumpFinalErrorOwnerSweep(hdRoutes)

  expect(output[0]?.route).toHaveLength(3)
  expect(output[1]?.route).toHaveLength(3)
  expect(
    rawForwardAttempts.filter((routeIndex) => routeIndex === 0),
  ).toHaveLength(2)
  expect(privateSolver.finalOwnerCandidatesAccepted).toBe(2)
})

test("Pipeline9 final-owner sweep never exceeds its separate 50k budget", () => {
  const srj = makeSrj(["A"])
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 0, z: 0, pcb_port_id: "A_start" },
        { x: 1, y: 0, z: 0, pcb_port_id: "A_end" },
      ],
    },
  ]
  const error = makeError("A_0", { x: 0, y: 0 })
  const drcEvaluator: DrcEvaluator = () => ({
    errors: [error],
    errorsWithCenters: [error],
  })
  const solver = makeSolver(srj, hdRoutes, drcEvaluator)
  const stubRerouter = {
    tryReroute: (
      _routes: HighDensityRoute[],
      options: Pipeline9IjumpRerouteOptions,
    ): Pipeline9IjumpRerouteResult => ({
      iterations: options.maxIterations,
    }),
  }
  const privateSolver = solver as unknown as {
    ijumpRerouter: typeof stubRerouter
    runIjumpFinalErrorOwnerSweep: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    finalOwnerIterations: number
  }
  privateSolver.ijumpRerouter = stubRerouter

  privateSolver.runIjumpFinalErrorOwnerSweep(hdRoutes)

  expect(privateSolver.finalOwnerIterations).toBe(50_000)
})
