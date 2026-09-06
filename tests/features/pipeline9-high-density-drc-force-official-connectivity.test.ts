import { expect, test } from "bun:test"
import { getBaseMaxIterations } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import { applyDrcErrorForces } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
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

test("Pipeline9 force repair follows official pad connectivity instead of routing aliases", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "node-a",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node-a",
    center: { x: 0, y: 0 },
    width: 4,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { ...route.route[0]!, connectionName: "A", pcb_port_id: "A-start" },
      { ...route.route[2]!, connectionName: "A", pcb_port_id: "A-end" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "A-start" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "A-end" },
        ],
      },
      {
        name: "B",
        pointsToConnect: [
          { x: 0, y: 0.27, layer: "top", pcb_port_id: "B-pad-port" },
          { x: 0, y: 1, layer: "top", pcb_port_id: "B-end" },
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
        // Routing aliases may group declared source connections that remain
        // distinct in the actual serialized board checked for pad clearance.
        connectedTo: ["B", "B-pad-port", "A"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "B-pad",
          pcb_port_id: "B-pad-port",
        },
      },
    ],
  }
  const originalInputs = structuredClone({ route, node, srj })
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  expect(connMap.areIdsConnected("A", "B-pad-port")).toBe(true)
  const inputRoutes = [route]
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: [srj.connections[0]!],
    originalConnections: srj.connections,
    hdRoutes: inputRoutes,
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
  const initialErrors = getPipeline9DrcErrors(evaluator, inputRoutes)
  expect(initialErrors).toHaveLength(1)
  expect(initialErrors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_pad_id: "B-pad",
  })
  const initialContext = evaluator.getForceContext(inputRoutes)
  expect(initialContext.connMap.areIdsConnected("A_0", "B-pad")).toBe(false)
  expect(initialContext.obstacles[0]!.connectedTo).toEqual(["B-pad"])
  const originalForceObstacles = structuredClone(initialContext.obstacles)
  const legacyRoutes = structuredClone(inputRoutes)
  // Even the exact offending pad center cannot overcome the old same-net
  // exclusion: the shared force operator sees no foreign obstacle to move from.
  expect(
    applyDrcErrorForces(
      srj,
      legacyRoutes,
      [{ ...initialErrors[0]!, center: { ...srj.obstacles[0]!.center } }],
      new Map([["A_0", 0]]),
      1,
      connMap,
      true,
      false,
      false,
      false,
    ),
  ).toBe(false)
  expect(legacyRoutes).toEqual(inputRoutes)

  let currentRoutes = inputRoutes
  let currentErrors = initialErrors
  let acceptedCount = 0
  for (
    let pass = 0;
    pass < getBaseMaxIterations(1) && currentErrors.length > 0;
    pass++
  ) {
    let accepted = false
    for (const candidate of getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: currentRoutes,
      errors: currentErrors,
      traceRouteIndexById: new Map([["A_0", 0]]),
      obstacles: srj.obstacles,
      connMap,
      forceContext: evaluator.getForceContext(currentRoutes),
      layerCount: 2,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      effort: 1,
    })) {
      const errors = getPipeline9DrcErrors(evaluator, candidate)
      if (!isPipeline9HighDensityDrcCandidateBetter(errors, currentErrors)) {
        continue
      }
      currentRoutes = candidate
      currentErrors = errors
      acceptedCount++
      accepted = true
      break
    }
    if (!accepted) break
  }
  expect(acceptedCount).toBeGreaterThan(0)
  expect(currentErrors).toHaveLength(0)
  expect(currentRoutes[0]).toMatchObject({
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "node-a",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    vias: [],
  })
  expect(currentRoutes[0]!.route[0]).toEqual(route.route[0])
  expect(currentRoutes[0]!.route.at(-1)).toEqual(route.route.at(-1))
  expect({ route, node, srj }).toEqual(originalInputs)
  expect(initialContext.obstacles).toEqual(originalForceObstacles)
})
