import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
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

const makeSolver = ({
  srj,
  hdRoutes,
  drcEvaluator,
  connMap,
}: {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  drcEvaluator: DrcEvaluator
  connMap?: ConnectivityMap
}) =>
  new Pipeline9ExactDrcRepairSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    connMap,
    originalObstacles: [],
    b01BaseObstacles: [],
    viaHoleDiameter: 0.15,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })

const makeTraceError = (traceId: string, center: { x: number; y: number }) => ({
  type: "pcb_trace_error",
  error_type: "pcb_trace_error",
  pcb_trace_id: traceId,
  pcb_trace_error_id: `overlap_${traceId}_fixed_trace`,
  candidate_pcb_trace_ids: [traceId],
  center,
})

const getViaPosition = (route: HighDensityRoute) => {
  for (
    let pointIndex = 0;
    pointIndex < route.route.length - 1;
    pointIndex += 1
  ) {
    const point = route.route[pointIndex]!
    const nextPoint = route.route[pointIndex + 1]!
    if (point.z !== nextPoint.z) return { x: point.x, y: point.y }
  }
  throw new Error(`Route "${route.connectionName}" has no via transition`)
}

test("Pipeline9 fairly schedules both directions for a terminal-rooted window", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    obstacles: [],
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pointId: "A_start" },
          { x: 1, y: 0, layer: "bottom", pointId: "A_end" },
        ],
      },
    ],
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -1, y: 0, z: 0, pcb_port_id: "A_start" },
        { x: -0.8, y: 0, z: 0 },
        { x: -0.6, y: 0, z: 0 },
        { x: -0.4, y: 0, z: 0 },
        { x: -0.2, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0.2, y: 0, z: 1 },
        { x: 0.6, y: 0, z: 1 },
        { x: 1, y: 0, z: 1, pcb_port_id: "A_end" },
      ],
    },
  ]
  const error = makeTraceError("A_0", { x: -0.5, y: 0 })
  const drcEvaluator: DrcEvaluator = ({ routes }) =>
    routes?.[0]?.rootConnectionName === "repaired"
      ? []
      : { errors: [error], errorsWithCenters: [error] }
  const solver = makeSolver({ srj, hdRoutes, drcEvaluator })
  const attempts: Pipeline9B01RerouteOptions[] = []
  const stubRerouter = {
    tryReroute: (
      routes: HighDensityRoute[],
      options: Pipeline9B01RerouteOptions,
    ): Pipeline9B01RerouteResult => {
      attempts.push({ ...options })
      if (!options.reverse) return { iterations: 100 }
      return {
        route: {
          ...routes[options.routeIndex]!,
          rootConnectionName: "repaired",
        },
        iterations: 100,
      }
    },
  }
  const privateSolver = solver as unknown as {
    b01Rerouter: typeof stubRerouter
    runPostFinalCompositeRepair: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    getSnapshot: (routes: HighDensityRoute[]) => { count: number }
    postFinalCompositeForwardAttempts: number
    postFinalCompositeReverseAttempts: number
    postFinalCompositeTerminalRootedAttempts: number
    postFinalCompositeCandidatesAccepted: number
  }
  privateSolver.b01Rerouter = stubRerouter

  const output = privateSolver.runPostFinalCompositeRepair(hdRoutes)

  expect(privateSolver.getSnapshot(output).count).toBe(0)
  expect(
    attempts.slice(0, 2).map(({ startIndex, endIndex, reverse }) => ({
      startIndex,
      endIndex,
      reverse,
    })),
  ).toEqual([
    { startIndex: 0, endIndex: 7, reverse: false },
    { startIndex: 0, endIndex: 7, reverse: true },
  ])
  expect(privateSolver.postFinalCompositeForwardAttempts).toBe(1)
  expect(privateSolver.postFinalCompositeReverseAttempts).toBe(1)
  expect(privateSolver.postFinalCompositeTerminalRootedAttempts).toBe(2)
  expect(privateSolver.postFinalCompositeCandidatesAccepted).toBe(1)
})

test("Pipeline9 atomically merges only the rerouted owner's canonical net", () => {
  const connectionYs = [-0.75, -0.25, 0.25, 0.75]
  const names = ["A", "A2", "B", "B2"]
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    obstacles: [],
    connections: names.map((name, index) => ({
      name,
      pointsToConnect: [
        {
          x: -1,
          y: connectionYs[index]!,
          layer: "top",
          pointId: `${name}_start`,
        },
        {
          x: 1,
          y: connectionYs[index]!,
          layer: "bottom",
          pointId: `${name}_end`,
        },
      ],
    })),
  }
  const makeViaRoute = (
    connectionName: string,
    terminalY: number,
    via: { x: number; y: number },
  ): HighDensityRoute => ({
    connectionName,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ ...via }],
    route: [
      {
        x: -1,
        y: terminalY,
        z: 0,
        pcb_port_id: `${connectionName}_start`,
      },
      { x: via.x, y: via.y, z: 0 },
      { x: via.x, y: via.y, z: 1 },
      {
        x: 1,
        y: terminalY,
        z: 1,
        pcb_port_id: `${connectionName}_end`,
      },
    ],
  })
  const hdRoutes: HighDensityRoute[] = [
    makeViaRoute("A", connectionYs[0]!, { x: 0, y: 0 }),
    makeViaRoute("A2", connectionYs[1]!, { x: 0.18, y: 0 }),
    makeViaRoute("B", connectionYs[2]!, { x: 0, y: 1 }),
    makeViaRoute("B2", connectionYs[3]!, { x: 0.18, y: 1 }),
  ]
  const traceError = makeTraceError("A_0", { x: -0.5, y: -0.375 })
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const routeA = routes?.[0]
    const routeA2 = routes?.[1]
    if (!routeA || !routeA2) return []
    if (routeA.rootConnectionName !== "rerouted") {
      return { errors: [traceError], errorsWithCenters: [traceError] }
    }

    const viaA = getViaPosition(routeA)
    const viaA2 = getViaPosition(routeA2)
    if (Math.hypot(viaA.x - viaA2.x, viaA.y - viaA2.y) <= 1e-6) {
      return []
    }
    const viaError = {
      type: "pcb_via_clearance_error",
      error_type: "pcb_via_clearance_error",
      message: "The raw reroute replaced one error with a same-net via error",
      center: {
        x: (viaA.x + viaA2.x) / 2,
        y: (viaA.y + viaA2.y) / 2,
      },
    }
    return { errors: [viaError], errorsWithCenters: [viaError] }
  }
  const solver = makeSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    connMap: new ConnectivityMap({
      target_net: ["A", "A2"],
      unrelated_net: ["B", "B2"],
    }),
  })
  const stubRerouter = {
    tryReroute: (
      routes: HighDensityRoute[],
      options: Pipeline9B01RerouteOptions,
    ): Pipeline9B01RerouteResult => ({
      route: {
        ...routes[options.routeIndex]!,
        rootConnectionName: "rerouted",
      },
      iterations: 50,
    }),
  }
  const privateSolver = solver as unknown as {
    b01Rerouter: typeof stubRerouter
    runPostFinalCompositeRepair: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    getSnapshot: (routes: HighDensityRoute[]) => { count: number }
    postFinalCompositeDrcEvaluations: number
    postFinalCompositeCandidatesAccepted: number
    postFinalCompositeSameNetViaMergeIterations: number
  }
  privateSolver.b01Rerouter = stubRerouter

  expect(privateSolver.getSnapshot(hdRoutes).count).toBe(1)
  const output = privateSolver.runPostFinalCompositeRepair(hdRoutes)

  expect(privateSolver.getSnapshot(output).count).toBe(0)
  expect(getViaPosition(output[0]!)).toEqual(getViaPosition(output[1]!))
  expect(output[2]).toEqual(hdRoutes[2])
  expect(output[3]).toEqual(hdRoutes[3])
  expect(privateSolver.postFinalCompositeDrcEvaluations).toBe(2)
  expect(privateSolver.postFinalCompositeCandidatesAccepted).toBe(1)
  expect(
    privateSolver.postFinalCompositeSameNetViaMergeIterations,
  ).toBeGreaterThan(0)
})
