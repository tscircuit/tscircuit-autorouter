import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import {
  getPipeline9DrcErrors,
  isPipeline9DrcCandidateBetter,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types/srj-types"

const createViaRoute = (
  connectionName: string,
  x: number,
  y: number,
  viaDiameter: number,
): HighDensityRoute => ({
  connectionName,
  rootConnectionName: connectionName,
  regionId: "local-node",
  traceThickness: 0.1,
  viaDiameter,
  route: [
    { x, y, z: 0 },
    { x, y, z: 1 },
  ],
  vias: [{ x, y }],
})

test("Pipeline9 local DRC gate preserves via ownership changes and full-board score deltas", (): void => {
  const originalRoutes: HighDensityRoute[] = [
    createViaRoute("A", 0, 0, 0.3),
    createViaRoute("B", 0, 0, 0.9),
    {
      connectionName: "C",
      rootConnectionName: "C",
      regionId: "distant-node",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 20, z: 0 },
        { x: 1, y: 20, z: 0 },
      ],
      vias: [],
    },
  ]
  const connections: SimpleRouteConnection[] = originalRoutes.map((route) => ({
    name: route.connectionName,
    pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
      (point, index) => ({
        x: point.x,
        y: point.y,
        layer: point.z === 0 ? "top" : "bottom",
        pcb_port_id: `${route.connectionName}-${index}`,
      }),
    ),
  }))
  const fixedTraces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "nearby-fixed-trace",
      connection_name: "nearby-fixed-net",
      route: [
        { route_type: "wire", x: -1, y: 0.4, layer: "top", width: 0.1 },
        { route_type: "wire", x: 1, y: 0.4, layer: "top", width: 0.1 },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "distant-fixed-trace",
      connection_name: "distant-fixed-net",
      route: [
        { route_type: "wire", x: 0, y: 19, layer: "top", width: 0.1 },
        { route_type: "wire", x: 0, y: 21, layer: "top", width: 0.1 },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 5, minY: -3, maxY: 23 },
    connections: [
      ...connections,
      ...fixedTraces.map((trace) => ({
        name: trace.connection_name,
        pointsToConnect: trace.route
          .filter((point) => point.route_type === "wire")
          .map((point, index) => ({
            x: point.x,
            y: point.y,
            layer: "top",
            pcb_port_id: `${trace.connection_name}-${index}`,
          })),
      })),
    ],
    obstacles: [],
    traces: fixedTraces,
  }
  const evaluatorOptions = {
    connections,
    originalConnections: srj.connections,
    hdRoutes: originalRoutes,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap: new ConnectivityMap({
      A: ["A", "A-0", "A-1"],
      B: ["B", "B-0", "B-1"],
      C: ["C", "C-0", "C-1"],
      "nearby-fixed-net": ["nearby-fixed-net"],
      "distant-fixed-net": ["distant-fixed-net"],
    }),
  }
  const evaluator = createPipeline9HighDensityDrcEvaluator(evaluatorOptions)
  const evaluateLocalCandidate = evaluator.evaluateLocalCandidate!
  // A initially hides B's larger colocated via during full-board conversion.
  // Moving A exposes B's copper and renumbers the serialized via identities.
  const exposedViaRoutes = [
    createViaRoute("A", 2, 0, 0.3),
    originalRoutes[1]!,
    originalRoutes[2]!,
  ]
  const repairedRoutes = [
    exposedViaRoutes[0]!,
    createViaRoute("B", 2, 2, 0.9),
    originalRoutes[2]!,
  ]
  for (const scenario of [
    {
      currentRoutes: originalRoutes,
      candidateRoutes: exposedViaRoutes,
      changedTraceIds: new Set(["A_0"]),
      expectedImprovement: false,
    },
    {
      currentRoutes: exposedViaRoutes,
      candidateRoutes: repairedRoutes,
      changedTraceIds: new Set(["B_0"]),
      expectedImprovement: true,
    },
  ]) {
    const local = evaluateLocalCandidate(scenario)
    const scopedPhaseTimes = [
      local.scopedTraceOverlapCheckTimeMs!,
      local.scopedViaTraceCheckTimeMs!,
      local.scopedPadTraceCheckTimeMs!,
    ]
    for (const phaseTime of scopedPhaseTimes) {
      expect(Number.isFinite(phaseTime)).toBeTrue()
      expect(phaseTime).toBeGreaterThanOrEqual(0)
    }
    expect(
      scopedPhaseTimes.reduce(
        (total, phaseTime): number => total + phaseTime,
        0,
      ),
    ).toBeLessThanOrEqual(local.scopedCopperCheckTimeMs!)
    const fullCurrentErrors = getPipeline9DrcErrors(
      evaluator,
      scenario.currentRoutes,
    )
    const fullCandidateErrors = getPipeline9DrcErrors(
      evaluator,
      scenario.candidateRoutes,
    )
    expect(local.currentErrors.length).toBeLessThan(fullCurrentErrors.length)
    expect(local.candidateErrors.length - local.currentErrors.length).toBe(
      fullCandidateErrors.length - fullCurrentErrors.length,
    )
    expect(
      isPipeline9DrcCandidateBetter(local.candidateErrors, local.currentErrors),
    ).toBe(scenario.expectedImprovement)
    expect(
      isPipeline9DrcCandidateBetter(fullCandidateErrors, fullCurrentErrors),
    ).toBe(scenario.expectedImprovement)
    // A local check must not mutate endpoint metadata used by full validation.
    const freshEvaluator =
      createPipeline9HighDensityDrcEvaluator(evaluatorOptions)
    expect(fullCandidateErrors).toEqual(
      getPipeline9DrcErrors(freshEvaluator, scenario.candidateRoutes),
    )
  }
})
