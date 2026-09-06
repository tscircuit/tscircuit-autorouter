import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("Pipeline9 one-sided trace candidates require two distinct local trace-only owners", (): void => {
  const routes: HighDensityRoute[] = ["A", "B"].map(
    (connectionName, index): HighDensityRoute => ({
      connectionName,
      rootConnectionName: connectionName,
      regionId: "pair-node",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [-2, -1, 1, 2].map((x) => ({ x, y: index * 0.15, z: 0 })),
      vias: [],
    }),
  )
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pair-node",
    center: { x: 0, y: 0 },
    width: 6,
    height: 6,
    availableZ: [0, 1],
    portPoints: routes.flatMap((route) =>
      [route.route[0]!, route.route.at(-1)!].map((point) => ({
        ...point,
        connectionName: route.connectionName,
      })),
    ),
  }
  const error: Pipeline9DrcError = {
    type: "pcb_trace_error",
    pcb_trace_error_id: "overlap_A_0_B_0",
    pcb_trace_id: "A_0",
    pcb_trace_ids: ["A_0", "B_0"],
    center: { x: 0, y: 0 },
    minimum_clearance: 0.1,
  }
  const connMap = new ConnectivityMap({ A: ["A", "A_0"], B: ["B", "B_0"] })
  const cases: {
    routes: HighDensityRoute[]
    error: Pipeline9DrcError
    traceRouteIndexById: Map<string, number>
    connMap: ConnectivityMap
  }[] = [
    {
      routes: [routes[0]!],
      error,
      traceRouteIndexById: new Map([["A_0", 0]]),
      connMap,
    },
    {
      routes: [routes[0]!],
      error,
      traceRouteIndexById: new Map([
        ["A_0", 0],
        ["B_0", 0],
      ]),
      connMap: new ConnectivityMap({ A: ["A", "A_0", "B_0"] }),
    },
    ...[
      { pcb_via_id: "B-via" },
      { pcb_via_ids: ["B-via"] },
      { __via_owner_trace_ids: ["B_0"] },
      { __pad_ids: ["foreign-pad"] },
    ].map((metadata) => ({
      routes,
      error: { ...error, ...metadata },
      traceRouteIndexById: new Map([
        ["A_0", 0],
        ["B_0", 1],
      ]),
      connMap,
    })),
  ]
  const original = structuredClone({ routes, node, error })
  for (const fixture of cases) {
    const attempts: Pipeline9HighDensityForceFamily[] = []
    const errorIndexes: number[] = []
    const candidates = getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: fixture.routes,
      errors: [fixture.error],
      traceRouteIndexById: fixture.traceRouteIndexById,
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      connMap: fixture.connMap,
      forceContext: { connMap: fixture.connMap, obstacles: [] },
      effort: 1,
      onCandidateAttempted: (family): void => {
        attempts.push(family)
      },
      onErrorAttempted: (errorIndex): void => {
        errorIndexes.push(errorIndex)
      },
    })
    for (const candidate of candidates) {
      expect(candidate).toHaveLength(fixture.routes.length)
    }
    expect(attempts.length).toBeGreaterThan(0)
    expect(attempts.every((family) => family === "native")).toBe(true)
    expect(errorIndexes).toEqual([0])
  }
  expect({ routes, node, error }).toEqual(original)
})
