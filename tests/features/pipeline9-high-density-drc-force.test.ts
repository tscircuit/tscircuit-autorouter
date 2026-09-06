import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getBaseMaxIterations } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9HighDensityForceCandidates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import { getPipeline9FixedRouteObstacles } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("Pipeline9 local DRC forces repair pad clearance with fixed node handoffs and other copper", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "force-node",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: [
      { x: -5, y: 0, z: 1, connectionName: "A" },
      { x: 5, y: 0, z: 0, connectionName: "A" },
    ],
  }
  const affectedRoute: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: node.capacityMeshNodeId,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    startPcbPortId: "port-a-start",
    endPcbPortId: "port-a-end",
    route: [
      { x: -5, y: 0, z: 1, pcb_port_id: "port-a-start" },
      { x: -5, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 5, y: 0, z: 0, pcb_port_id: "port-a-end" },
    ],
    vias: [{ x: -5, y: 0 }],
  }
  const fixedRoute: HighDensityRoute = {
    connectionName: "B",
    rootConnectionName: "B",
    regionId: node.capacityMeshNodeId,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -5, y: 3, z: 0 },
      { x: 5, y: 3, z: 0 },
    ],
    vias: [],
  }
  const inputRoutes = [affectedRoute, fixedRoute]
  const originalRoutes = structuredClone(inputRoutes)
  const connMap = new ConnectivityMap({
    A: ["A"],
    B: ["B"],
    C: ["C", "port-c-start", "port-c-end"],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    obstacles: [
      {
        type: "rect",
        obstacleId: "fixed-pad",
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad-c-start",
          pcb_port_id: "port-c-start",
        },
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["C", "port-c-start"],
      },
    ],
    connections: [
      ...inputRoutes.map((route) => ({
        name: route.connectionName,
        pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
          (point) => ({
            x: point.x,
            y: point.y,
            layer: point.z === 0 ? "top" : "bottom",
            pcb_port_id: point.pcb_port_id,
          }),
        ),
      })),
      {
        name: "C",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "port-c-start" },
          { x: 0, y: 4, layer: "top", pcb_port_id: "port-c-end" },
        ],
      },
    ],
  }
  const drcEvaluator = createPipeline9HighDensityDrcEvaluator({
    connections: srj.connections.filter(
      (connection) => connection.name !== "C",
    ),
    originalConnections: srj.connections,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    hdRoutes: inputRoutes,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  const initialErrors = getPipeline9DrcErrors(drcEvaluator, inputRoutes)
  expect(initialErrors.length).toBeGreaterThan(0)
  expect(
    initialErrors.some(
      (error) =>
        Array.isArray(error.__pad_ids) &&
        error.__pad_ids.includes("pad-c-start"),
    ),
  ).toBe(true)
  const fixedObstacles = getPipeline9FixedRouteObstacles({
    fixedObstacleRoutes: [fixedRoute],
    layerCount: 2,
  })
  const originalFixedObstacles = structuredClone(fixedObstacles)
  let improvedRoutes = [affectedRoute]
  let currentErrors = initialErrors
  let acceptedPassCount = 0
  let yieldedCandidateCount = 0
  for (
    let pass = 0;
    pass < getBaseMaxIterations(1) && currentErrors.length > 0;
    pass++
  ) {
    let accepted = false
    for (const candidate of getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: improvedRoutes,
      forceContext: drcEvaluator.getForceContext([
        ...improvedRoutes,
        fixedRoute,
      ]),
      errors: currentErrors,
      traceRouteIndexById: new Map([["A_0", 0]]),
      obstacles: [...srj.obstacles, ...fixedObstacles],
      layerCount: 2,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      connMap,
      effort: 1,
    })) {
      yieldedCandidateCount++
      const errors = getPipeline9DrcErrors(drcEvaluator, [
        ...candidate,
        fixedRoute,
      ])
      if (!isPipeline9HighDensityDrcCandidateBetter(errors, currentErrors)) {
        continue
      }
      improvedRoutes = candidate
      currentErrors = errors
      acceptedPassCount++
      accepted = true
      break
    }
    if (!accepted) break
  }
  expect({
    remainingErrors: currentErrors.length,
    acceptedPassCount,
    yieldedCandidateCount,
  }).toMatchObject({ remainingErrors: 0 })
  expect(acceptedPassCount).toBeGreaterThan(0)
  expect(improvedRoutes![0]!.route.slice(0, 2)).toEqual(
    affectedRoute.route.slice(0, 2),
  )
  expect(improvedRoutes![0]!.route.at(-1)).toEqual(affectedRoute.route.at(-1))
  expect(improvedRoutes![0]!.vias).toEqual(affectedRoute.vias)
  expect(improvedRoutes![0]!.regionId).toBe(affectedRoute.regionId)
  expect(improvedRoutes![0]!.startPcbPortId).toBe(affectedRoute.startPcbPortId)
  expect(improvedRoutes![0]!.endPcbPortId).toBe(affectedRoute.endPcbPortId)
  expect(inputRoutes).toEqual(originalRoutes)
  expect(fixedObstacles).toEqual(originalFixedObstacles)
})
