import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  DrcEvaluator,
  SimpleRouteJson,
} from "high-density-repair03/lib"
import { applyPipeline9ReferenceDrcRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ReferenceDrcRepairs"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 reference DRC repair preserves electrical route invariants", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "signal_start" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "signal_end" },
        ],
      },
      {
        name: "blocker",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["signal", "signal_start"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["signal", "signal_end"],
      },
    ],
    layerCount: 3,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      route: [
        { x: -2, y: 0, z: 0, pcb_port_id: "signal_start" },
        { x: -0.5, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
        { x: 2, y: 0, z: 0, pcb_port_id: "signal_end" },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "blocker",
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ hdRoutes, routes }) => {
    const candidateRoutes = hdRoutes ?? routes ?? []
    const signalRoute = candidateRoutes.find(
      (route) => route.connectionName === "signal",
    )
    const signalRepaired =
      signalRoute?.route.some((point) => point.z === 2) &&
      signalRoute.vias.length === 2 &&
      signalRoute.vias.every((via) => Math.abs(via.x) > 1.5)
    const errors = signalRepaired
      ? []
      : [
          {
            type: "pcb_trace_error",
            pcb_trace_id: "blocker_0",
            pcb_trace_error_id: "overlap_blocker_0_signal_0",
            center: { x: 0, y: 0 },
            message: "Signal trace crosses another trace",
          },
        ]
    return { errors, errorsWithCenters: errors }
  }
  const initialErrors = drcEvaluator({ hdRoutes: routes, traces: [] })
  if (Array.isArray(initialErrors)) {
    throw new Error("Expected structured DRC evaluation result")
  }
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["signal", "signal_start", "signal_end"],
    ["blocker"],
  ])

  const result = applyPipeline9ReferenceDrcRepairs({
    srj,
    routes,
    initialErrors: initialErrors.errorsWithCenters ?? initialErrors.errors,
    connMap,
    drcEvaluator,
    effort: 1,
    maxIterations: 16,
    viaHoleDiameter: 0.15,
    allowViaInPad: false,
  })

  expect(result.accepted).toBeTrue()
  expect(result.remainingErrors).toHaveLength(0)
  expect(result.routes[0]?.connectionName).toBe("signal")
  expect(result.routes[0]?.traceThickness).toBe(0.1)
  expect(result.routes[0]?.route[0]).toMatchObject(routes[0]!.route[0]!)
  expect(result.routes[0]?.route.at(-1)).toMatchObject(
    routes[0]!.route.at(-1)!,
  )
})
