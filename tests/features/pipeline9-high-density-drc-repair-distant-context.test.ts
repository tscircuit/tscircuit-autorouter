import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types/srj-types"

test("Pipeline9 does not retry an exhausted node after a distant copper repair", (): void => {
  const nodes: NodeWithPortPoints[] = [0, 10].map((y, index) => {
    const connectionName = index === 0 ? "A" : "B"
    return {
      capacityMeshNodeId: index === 0 ? "node-a" : "node-b",
      center: { x: 0, y },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [-2, 2].map((x) => ({
        x,
        y,
        z: 0,
        connectionName,
        rootConnectionName: connectionName,
        pcb_port_id: `${connectionName}-${x < 0 ? "start" : "end"}`,
      })),
    }
  })
  const connections: SimpleRouteConnection[] = nodes.map((node) => ({
    name: node.portPoints[0]!.connectionName,
    pointsToConnect: node.portPoints.map((point) => ({
      x: point.x,
      y: point.y,
      layer: "top",
      pcb_port_id: point.pcb_port_id,
    })),
  }))
  const inputRoutes: HighDensityRoute[] = nodes.map((node) => ({
    connectionName: node.portPoints[0]!.connectionName,
    rootConnectionName: node.portPoints[0]!.connectionName,
    regionId: node.capacityMeshNodeId,
    startPcbPortId: node.portPoints[0]!.pcb_port_id,
    endPcbPortId: node.portPoints[1]!.pcb_port_id,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: node.portPoints.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
      pcb_port_id: point.pcb_port_id,
    })),
    vias: [],
  }))
  const obstacles: Obstacle[] = [
    ...["top", "bottom"].map((layer): Obstacle => ({
      obstacleId: `locked-endpoint-pad-${layer}`,
      circuitJsonMetadata: {
        pcb_smtpad_id: `pad-c-start-${layer}`,
        pcb_port_id: `C-start-${layer}`,
      },
      type: "rect",
      layers: [layer],
      center: { x: -2, y: 0.22 },
      width: 0.2,
      height: 0.2,
      connectedTo: ["C", `C-start-${layer}`],
    })),
    {
      obstacleId: "repairable-center-pad",
      circuitJsonMetadata: {
        pcb_smtpad_id: "pad-c-end",
        pcb_port_id: "C-end",
      },
      type: "rect",
      layers: ["top"],
      center: { x: 0, y: 10 },
      width: 0.2,
      height: 0.2,
      connectedTo: ["C", "C-end"],
    },
  ]
  const connMap = new ConnectivityMap({
    A: ["A", "A-start", "A-end"],
    B: ["B", "B-start", "B-end"],
    C: ["C", "C-start-top", "C-start-bottom", "C-end"],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 13 },
    connections: [
      ...connections,
      {
        name: "C",
        pointsToConnect: [
          {
            x: -2,
            y: 0.22,
            layer: "top",
            pcb_port_id: "C-start-top",
          },
          {
            x: -2,
            y: 0.22,
            layer: "bottom",
            pcb_port_id: "C-start-bottom",
          },
          { x: 0, y: 10, layer: "top", pcb_port_id: "C-end" },
        ],
      },
    ],
    obstacles,
  }
  const officialEvaluator = createPipeline9HighDensityDrcEvaluator({
    connections,
    originalConnections: srj.connections,
    hdRoutes: inputRoutes,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    layerCount: 2,
    obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  let solver: Pipeline9HighDensityDrcRepairSolver
  let exhaustedNodeEvaluationCount = 0
  let exhaustedNodeAttemptCount = 0
  const drcEvaluator: DrcEvaluator = (
    params: Parameters<DrcEvaluator>[0],
  ): ReturnType<DrcEvaluator> => {
    if (solver.activeNode?.capacityMeshNodeId === "node-a") {
      exhaustedNodeEvaluationCount++
    }
    return officialEvaluator(params)
  }
  solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: nodes,
    hdRoutes: inputRoutes,
    fixedHdRoutes: [],
    newConnections: connections,
    drcEvaluator,
    connMap,
    colorMap: {},
    obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    drcClearance: 0.1,
    effort: 0.1,
  })
  const stepAndTrackNodeAttempts = (): void => {
    const previousNodeId = solver.activeNode?.capacityMeshNodeId
    solver.step()
    if (
      previousNodeId !== "node-a" &&
      solver.activeNode?.capacityMeshNodeId === "node-a"
    ) {
      exhaustedNodeAttemptCount++
    }
  }

  // A's locked endpoint has only 0.07 mm copper clearance on either layer.
  // The pads do not touch the endpoint, so conversion cannot infer a connection.
  // B can detour around its center pad without changing A's copper context.
  while (
    !solver.solved &&
    !solver.failed &&
    solver.activeNode?.capacityMeshNodeId !== "node-b"
  ) {
    stepAndTrackNodeAttempts()
  }
  expect(solver.activeNode?.capacityMeshNodeId).toBe("node-b")
  expect(exhaustedNodeAttemptCount).toBe(1)
  expect(Number(solver.stats.exhaustedNodeCount)).toBe(1)
  const initialDrcIssueCount = Number(solver.stats.initialDrcIssueCount)
  const evaluationCountBeforeDistantRepair = exhaustedNodeEvaluationCount
  expect(initialDrcIssueCount).toBeGreaterThan(1)

  while (!solver.solved && !solver.failed) {
    stepAndTrackNodeAttempts()
  }

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.acceptedNodeCount).toBe(1)
  expect(solver.currentErrors.length).toBeGreaterThan(0)
  expect(solver.currentErrors.length).toBeLessThan(initialDrcIssueCount)
  expect(solver.outputHdRoutes[0]).toBe(inputRoutes[0])
  expect(solver.outputHdRoutes[1]).not.toEqual(inputRoutes[1])
  expect(exhaustedNodeEvaluationCount).toBe(evaluationCountBeforeDistantRepair)
  // Count starts too: an anchor-rejected retry may never call the evaluator.
  expect(exhaustedNodeAttemptCount).toBe(1)
})
