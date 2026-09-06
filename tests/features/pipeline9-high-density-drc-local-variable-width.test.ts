import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types/srj-types"

test("Pipeline9 local DRC includes the starting wire width at its far endpoint", (): void => {
  const originalRoute: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "via-node",
    traceThickness: 0.1,
    viaDiameter: 0.2,
    route: [
      { x: 12, y: 0, z: 0 },
      { x: 12, y: 0, z: 1 },
    ],
    vias: [{ x: 12, y: 0 }],
  }
  const currentRoutes = [originalRoute]
  const candidateRoutes: HighDensityRoute[] = [
    {
      ...originalRoute,
      route: [
        { x: 10.5, y: 0, z: 0 },
        { x: 10.5, y: 0, z: 1 },
      ],
      vias: [{ x: 10.5, y: 0 }],
    },
  ]
  const connections: SimpleRouteConnection[] = [
    {
      name: "A",
      pointsToConnect: [
        { x: 12, y: 0, layer: "top", pcb_port_id: "A-top" },
        { x: 12, y: 0, layer: "bottom", pcb_port_id: "A-bottom" },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.2,
    bounds: { minX: -1, maxX: 14, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      ...connections,
      {
        name: "fixed-net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "fixed-start" },
          { x: 10, y: 0, layer: "top", pcb_port_id: "fixed-end" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "wide-fixed-trace",
        connection_name: "fixed-net",
        route: [
          { route_type: "wire", x: 0, y: 0, layer: "top", width: 1 },
          { route_type: "wire", x: 10, y: 0, layer: "top", width: 0.1 },
        ],
      },
    ],
  }
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections,
    originalConnections: srj.connections,
    hdRoutes: currentRoutes,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.1,
    connMap: new ConnectivityMap({
      A: ["A", "A-top", "A-bottom"],
      "fixed-net": ["fixed-net", "fixed-start", "fixed-end"],
    }),
  })

  // The segment is 1 mm wide through x=10 despite its final point's width.
  // Using only that point's 0.1 mm width would omit the fixed trace locally.
  const local = evaluator.evaluateLocalCandidate!({
    currentRoutes,
    candidateRoutes,
    changedTraceIds: new Set(["A_0"]),
  })
  const fullCurrentErrors = getPipeline9DrcErrors(evaluator, currentRoutes)
  const fullCandidateErrors = getPipeline9DrcErrors(evaluator, candidateRoutes)

  expect(fullCurrentErrors).toHaveLength(0)
  expect(fullCandidateErrors.length).toBeGreaterThan(0)
  expect(local.currentErrors).toHaveLength(fullCurrentErrors.length)
  expect(local.candidateErrors).toHaveLength(fullCandidateErrors.length)
})
