import { expect, test } from "bun:test"
import {
  checkEachPcbTraceNonOverlapping,
  checkPadPadClearance,
  checkPadTraceClearance,
} from "@tscircuit/checks"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import { doRegionPortPairsCross } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/doRegionPortPairsCross"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/prefab-clad/prefab-clad01.srj.json"

const forcedPrefabConnectionNames = [
  "sample_connection_usb_dm_a",
  "sample_connection_gnd_00__sample_connection_gnd_01__sample_connection_gnd_02_mst1",
]

test("prefab-clad01 routes the clad1 single-layer validation workload", () => {
  const srj = srjJson as SimpleRouteJson
  const assignableObstacles = srj.obstacles.filter(
    (obstacle) => obstacle.netIsAssignable === true,
  )
  const obstaclesByPrefabConnection = new Map<string, Obstacle[]>()

  expect(srj.connections).toHaveLength(10)
  expect(assignableObstacles).toHaveLength(80)
  for (const obstacle of assignableObstacles) {
    expect(obstacle.obstacleId?.startsWith("obstacle_hole_")).toBe(true)
    expect(obstacle.layers).toEqual(["top"])
    expect(obstacle.offBoardConnectsTo).toHaveLength(1)
    const prefabConnectionId = obstacle.offBoardConnectsTo![0]!
    expect(obstacle.connectedTo).toContain(prefabConnectionId)

    const pairedObstacles =
      obstaclesByPrefabConnection.get(prefabConnectionId) ?? []
    pairedObstacles.push(obstacle)
    obstaclesByPrefabConnection.set(prefabConnectionId, pairedObstacles)
  }

  expect(obstaclesByPrefabConnection.size).toBe(40)
  for (const pairedObstacles of obstaclesByPrefabConnection.values()) {
    expect(pairedObstacles).toHaveLength(2)
    expect(pairedObstacles[0]!.obstacleId).not.toBe(
      pairedObstacles[1]!.obstacleId,
    )
  }

  const pipeline = new AssignableAutoroutingPipeline2(srj, {
    cacheProvider: null,
    effort: 1,
    forceOffBoardConnectionNames: forcedPrefabConnectionNames,
  })
  pipeline.solveUntilPhase("portPointPathingSolver")

  expect(pipeline.failed).toBe(false)
  expect(pipeline.relateNodesToOffBoardConnections?.nodesInNet.size).toBe(40)
  expect(pipeline.srjWithPointPairs?.connections).toHaveLength(10)

  pipeline.solveUntilPhase("multiSectionPortPointOptimizer")
  const pathingAdapter = pipeline.portPointPathingSolver!
  const solver = pathingAdapter.hypergraphSolver!
  const graph = solver.graph

  expect(pathingAdapter.usesHypergraph).toBe(true)
  expect(pipeline.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes).toHaveLength(10)
  expect(
    graph.regions.filter((region) => region.d._offBoardConnectionId),
  ).toHaveLength(40)

  const prefabTransitions = solver.solvedRoutes.flatMap((route) =>
    route.path.flatMap((candidate) => {
      const prefabConnectionId = candidate.lastRegion?.d._offBoardConnectionId
      if (!prefabConnectionId || !candidate.lastPort) return []
      return [
        {
          connectionName: route.connection.connectionId,
          prefabConnectionId,
          entranceNodeId:
            candidate.lastPort.d.offBoardEndpointCapacityMeshNodeId,
          exitNodeId: candidate.port.d.offBoardEndpointCapacityMeshNodeId,
        },
      ]
    }),
  )
  expect(prefabTransitions).toHaveLength(2)
  expect(
    prefabTransitions.map((transition) => transition.connectionName).sort(),
  ).toEqual([...forcedPrefabConnectionNames].sort())
  for (const transition of prefabTransitions) {
    expect(transition.entranceNodeId).toBeDefined()
    expect(transition.exitNodeId).toBeDefined()
    expect(transition.entranceNodeId).not.toBe(transition.exitNodeId)
  }

  const downstreamNodes = pathingAdapter.getNodesWithPortPoints()
  expect(
    downstreamNodes.some((node) =>
      node.capacityMeshNodeId.startsWith("offboard:"),
    ),
  ).toBe(false)
  for (const transition of prefabTransitions) {
    const physicalEndpointIds = new Set([
      transition.entranceNodeId,
      transition.exitNodeId,
    ])
    expect(
      downstreamNodes.filter((node) =>
        physicalEndpointIds.has(node.capacityMeshNodeId),
      ),
    ).toHaveLength(2)
  }

  const differentNetCrossings = graph.regions.flatMap((region) => {
    if (region.d._offBoardConnectionId) return []
    const assignments = region.assignments ?? []
    return assignments.flatMap((assignment, assignmentIndex) =>
      assignments.slice(assignmentIndex + 1).flatMap((otherAssignment) => {
        if (
          assignment.connection.mutuallyConnectedNetworkId ===
          otherAssignment.connection.mutuallyConnectedNetworkId
        ) {
          return []
        }
        return doRegionPortPairsCross(
          region,
          assignment.regionPort1,
          assignment.regionPort2,
          otherAssignment.regionPort1,
          otherAssignment.regionPort2,
        )
          ? [
              `${region.regionId}:${assignment.connection.connectionId}:${otherAssignment.connection.connectionId}`,
            ]
          : []
      }),
    )
  })
  expect(differentNetCrossings).toEqual([])

  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.failed).toBe(false)

  const outputTraces = pipeline.getOutputSimplifiedPcbTraces()
  expect(outputTraces).toHaveLength(
    pipeline.srjWithPointPairs!.connections.length + prefabTransitions.length,
  )
  expect(outputTraces).toHaveLength(
    pipeline.highDensityStitchSolver!.mergedHdRoutes.length,
  )
  expect(outputTraces.every((trace) => trace.connectsTo?.length === 2)).toBe(
    true,
  )

  const outputConnectivityIds = new Set(
    outputTraces.flatMap((trace) => trace.connectsTo ?? []),
  )
  const expectedTerminalIds = new Set(
    pipeline.srjWithPointPairs!.connections.flatMap((connection) =>
      connection.pointsToConnect.flatMap((point) => {
        const id = point.pcb_port_id ?? point.pointId
        return id ? [id] : []
      }),
    ),
  )
  expect(
    [...expectedTerminalIds].filter((id) => !outputConnectivityIds.has(id)),
  ).toEqual([])

  const usedPortalObstacleIds = new Set(
    [...outputConnectivityIds].filter((id) => id.startsWith("obstacle_hole_")),
  )
  expect(usedPortalObstacleIds).toHaveLength(prefabTransitions.length * 2)
  expect([...usedPortalObstacleIds].sort()).toEqual(
    [
      "obstacle_hole_top_r0_000",
      "obstacle_hole_top_r1_000",
      "obstacle_hole_top_r1_001",
      "obstacle_hole_top_r1_006",
    ].sort(),
  )
  for (const pairedObstacles of obstaclesByPrefabConnection.values()) {
    const usedObstacles = pairedObstacles.filter((obstacle) =>
      usedPortalObstacleIds.has(obstacle.obstacleId!),
    )
    expect([0, 2]).toContain(usedObstacles.length)
  }

  const circuitJson = convertToCircuitJson(
    pipeline.srjWithPointPairs!,
    outputTraces,
    {
      minTraceWidth: srj.minTraceWidth,
      originalSrj: srj,
    },
  )
  expect(
    circuitJson.filter(
      (element) =>
        element.type === "pcb_plated_hole" &&
        element.pcb_plated_hole_id.startsWith("pcb_plated_hole_obstacle_hole_"),
    ),
  ).toHaveLength(80)

  // The SRJ width is the clearance-inflated routing envelope (0.20 mm copper
  // plus 0.10 mm clearance), so a second clearance here would double-count it.
  const physicalDrcErrors = [
    ...checkEachPcbTraceNonOverlapping(circuitJson, { minClearance: 0 }),
    ...checkPadTraceClearance(circuitJson, { minClearance: 0 }),
    ...checkPadPadClearance(circuitJson, { minClearance: 0 }),
  ]
  expect(physicalDrcErrors).toEqual([])

  // Snapshot the actual stitched PCB output, not the abstract hypergraph.
  expect(
    convertCircuitJsonToPcbSvg(circuitJson, {
      width: 1400,
      height: 980,
      matchBoardAspectRatio: true,
      backgroundColor: "#101216",
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "routed-output",
    tolerance: 0.02,
  })
}, 20_000)
