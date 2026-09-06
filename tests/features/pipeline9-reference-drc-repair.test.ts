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
          { x: -2, y: -1, layer: "top", pcb_port_id: "signal_start" },
          { x: 2, y: -1, layer: "top", pcb_port_id: "signal_end" },
        ],
      },
      {
        name: "unrelated",
        pointsToConnect: [
          { x: -2, y: 1.5, layer: "top" },
          { x: 2, y: 1.5, layer: "top" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: -1 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["signal", "signal_start"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: -1 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["signal", "signal_end"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["foreign_pad"],
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
        { x: -2, y: -1, z: 0, pcb_port_id: "signal_start" },
        { x: -2, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 2, y: -1, z: 0, pcb_port_id: "signal_end" },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "unrelated",
      route: [
        { x: -2, y: 1.5, z: 0 },
        { x: 2, y: 1.5, z: 0 },
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
    const signalRepaired = (signalRoute?.route[1]?.y ?? 0) >= 0.2
    const errors = signalRepaired
      ? []
      : [
          {
            type: "pcb_trace_error",
            pcb_trace_id: "signal_0",
            center: { x: 0, y: 0 },
            message: "Signal trace overlaps a foreign pad",
          },
        ]
    return { errors, errorsWithCenters: errors }
  }
  const initialErrors = drcEvaluator({ hdRoutes: routes, traces: [] })
  if (Array.isArray(initialErrors)) {
    throw new Error("Expected structured DRC evaluation result")
  }
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["signal", "signal_start", "signal_end"]])

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
  expect(result.routes[1]).toEqual(routes[1])
})
