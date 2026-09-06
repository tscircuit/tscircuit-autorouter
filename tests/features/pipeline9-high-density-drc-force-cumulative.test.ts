import { expect, test } from "bun:test"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9HighDensityForceCandidates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 cumulative forces cross a binary overlap without mutating earlier candidates", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "force-node",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [],
  }
  const originalRoute = structuredClone(route)
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "force-node",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: [
      { x: -4, y: 0, z: 0, connectionName: "A", pcb_port_id: "A-start" },
      { x: 4, y: 0, z: 0, connectionName: "A", pcb_port_id: "A-end" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -4, y: 0, layer: "top", pcb_port_id: "A-start" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "A-end" },
        ],
      },
      {
        name: "B",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "B-start" },
          { x: 0, y: 4, layer: "top", pcb_port_id: "B-end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["B", "B-start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "binary-overlap-pad",
          pcb_port_id: "B-start",
        },
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: [srj.connections[0]!],
    originalConnections: srj.connections,
    hdRoutes: [route],
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const initialErrors = getPipeline9DrcErrors(evaluator, [route])
  expect(initialErrors.length).toBeGreaterThan(0)
  const candidates = getPipeline9HighDensityForceCandidates({
    node,
    hdRoutes: [route],
    forceContext: evaluator.getForceContext([route]),
    errors: initialErrors,
    traceRouteIndexById: new Map([["A_0", 0]]),
    obstacles: srj.obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    connMap,
    effort: 1,
  })
  const first = candidates.next()
  if (first.done) throw new Error("Expected the initial force candidate")
  const originalFirstCandidate = structuredClone(first.value)
  const firstErrors = getPipeline9DrcErrors(evaluator, first.value)
  expect(firstErrors).toHaveLength(initialErrors.length)
  expect(
    isPipeline9HighDensityDrcCandidateBetter(firstErrors, initialErrors),
  ).toBe(false)

  const second = candidates.next()
  if (second.done) throw new Error("Expected a cumulative force candidate")
  const originalSecondCandidate = structuredClone(second.value)
  const secondErrors = getPipeline9DrcErrors(evaluator, second.value)
  expect(secondErrors).toHaveLength(0)
  expect(
    isPipeline9HighDensityDrcCandidateBetter(secondErrors, initialErrors),
  ).toBe(true)
  expect(second.value[0]!.route[0]).toEqual(originalRoute.route[0])
  expect(second.value[0]!.route.at(-1)).toEqual(originalRoute.route.at(-1))
  expect(first.value).toEqual(originalFirstCandidate)

  for (const candidate of candidates) {
    expect(candidate[0]!.route[0]).toEqual(originalRoute.route[0])
    expect(candidate[0]!.route.at(-1)).toEqual(originalRoute.route.at(-1))
  }
  expect(first.value).toEqual(originalFirstCandidate)
  expect(second.value).toEqual(originalSecondCandidate)
  expect(route).toEqual(originalRoute)
})
