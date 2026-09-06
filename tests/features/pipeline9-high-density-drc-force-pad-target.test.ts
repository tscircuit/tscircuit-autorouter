import { expect, test } from "bun:test"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9HighDensityForceCandidates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 pad forces target the referenced pad without rewriting official error centers", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "pad-target-node",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [-4, 1.5, 2.5, 4].map((x) => ({ x, y: 0, z: 0 })),
    vias: [],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pad-target-node",
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
          { x: 2, y: 0.27, layer: "top", pcb_port_id: "B-start" },
          { x: 2, y: 4, layer: "top", pcb_port_id: "B-end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 2, y: 0.27 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["B", "B-start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "off-center-pad",
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
  expect(initialErrors).toHaveLength(1)
  expect(initialErrors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    center: { x: 0, y: 0 },
    __pad_ids: ["off-center-pad"],
    __pad_centers: [{ x: 2, y: 0.27 }],
  })
  const originalInputs = structuredClone({ route, node, srj, initialErrors })
  const rejections: Record<string, number> = {}
  let yieldedCandidateCount = 0
  let repaired: HighDensityRoute[] | undefined
  for (const candidate of getPipeline9HighDensityForceCandidates({
    node,
    hdRoutes: [route],
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
    onCandidateRejected: (reason): void => {
      rejections[reason] = (rejections[reason] ?? 0) + 1
    },
  })) {
    yieldedCandidateCount++
    if (getPipeline9DrcErrors(evaluator, candidate).length !== 0) continue
    repaired = candidate
    break
  }
  if (!repaired) {
    console.log("Pipeline9 off-center pad force diagnostics", {
      initialErrors,
      yieldedCandidateCount,
      rejections,
    })
  }
  expect(repaired).toBeDefined()
  expect(getPipeline9DrcErrors(evaluator, repaired!)).toHaveLength(0)
  expect(repaired![0]!.route[0]).toEqual(route.route[0])
  expect(repaired![0]!.route.at(-1)).toEqual(route.route.at(-1))
  expect({ route, node, srj, initialErrors }).toEqual(originalInputs)
})
