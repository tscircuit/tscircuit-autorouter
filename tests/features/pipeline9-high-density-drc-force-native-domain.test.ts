import { expect, test } from "bun:test"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9HighDensityForceCandidates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityRouteInsideBounds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityRouteInsideBounds"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 forces preserve an external terminal within the native HD domain", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "terminal-leap-node",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [-2, -0.5, 0.5, 1].map((x) => ({ x, y: 0, z: 0 })),
    vias: [],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "terminal-leap-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 4,
    availableZ: [0, 1],
    portPoints: [
      { x: -2, y: 0, z: 0, connectionName: "A", pcb_port_id: "A-start" },
      { x: 1, y: 0, z: 0, connectionName: "A", pcb_port_id: "A-end" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "A-start" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "A-end" },
        ],
      },
      {
        name: "B",
        pointsToConnect: [
          { x: 0, y: 0.27, layer: "top", pcb_port_id: "B-start" },
          { x: 0, y: 2, layer: "top", pcb_port_id: "B-end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0.27 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["B", "B-start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "interior-pad",
          pcb_port_id: "B-start",
        },
      },
    ],
  }
  const nativeBounds = getBoundsFromNodeWithPortPoints(node)
  expect(nativeBounds).toEqual({ minX: -2, maxX: 1, minY: -2, maxY: 2 })
  expect(route.route[0]!.x).toBeLessThan(node.center.x - node.width / 2)
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
  const originalInputs = structuredClone({ route, node, srj, initialErrors })
  const rejections: Record<string, number> = {}
  let repaired: HighDensityRoute[] | undefined
  for (const candidate of getPipeline9HighDensityForceCandidates({
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
    onCandidateRejected: (reason): void => {
      rejections[reason] = (rejections[reason] ?? 0) + 1
    },
  })) {
    expect(
      isPipeline9HighDensityRouteInsideBounds(candidate[0]!, nativeBounds, 2),
    ).toBe(true)
    if (getPipeline9DrcErrors(evaluator, candidate).length !== 0) continue
    repaired = candidate
    break
  }
  if (!repaired) {
    console.log("Pipeline9 native HD domain force diagnostics", {
      initialErrors,
      nativeBounds,
      rejections,
    })
  }
  expect(repaired).toBeDefined()
  expect(getPipeline9DrcErrors(evaluator, repaired!)).toHaveLength(0)
  expect(repaired![0]!.route[0]).toEqual(route.route[0])
  expect(repaired![0]!.route.at(-1)).toEqual(route.route.at(-1))
  const escapedCandidate = structuredClone(repaired![0]!)
  escapedCandidate.route[1]!.x = nativeBounds.maxX + route.traceThickness
  expect(
    isPipeline9HighDensityRouteInsideBounds(escapedCandidate, nativeBounds, 2),
  ).toBe(false)
  expect({ route, node, srj, initialErrors }).toEqual(originalInputs)
})
