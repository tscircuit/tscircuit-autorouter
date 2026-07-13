import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import {
  doPointPairsCrossInRegion,
  doRegionPortPairsCross,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/doRegionPortPairsCross"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/prefab-clad/prefab-clad01.srj.json"

test("prefab-clad01 hypergraph is planar and uses assignable plated-hole pairs", () => {
  const srj = srjJson as SimpleRouteJson
  const assignableObstacles = srj.obstacles.filter(
    (obstacle) => obstacle.netIsAssignable === true,
  )
  const obstaclesByPrefabConnection = new Map<string, Obstacle[]>()

  expect(assignableObstacles).toHaveLength(80)
  for (const obstacle of assignableObstacles) {
    const prefabConnectionIds = obstacle.connectedTo.filter((connectionId) =>
      connectionId.startsWith("connection_"),
    )
    expect(obstacle.obstacleId?.startsWith("obstacle_hole_")).toBe(true)
    expect(obstacle.layers).toEqual(["top"])
    expect(prefabConnectionIds).toHaveLength(1)
    expect(obstacle.offBoardConnectsTo).toBeUndefined()

    const prefabConnectionId = prefabConnectionIds[0]
    const pairedObstacles =
      obstaclesByPrefabConnection.get(prefabConnectionId) ?? []
    pairedObstacles.push(obstacle)
    obstaclesByPrefabConnection.set(prefabConnectionId, pairedObstacles)
  }

  expect(obstaclesByPrefabConnection.size).toBe(40)
  for (const pairedObstacles of obstaclesByPrefabConnection.values()) {
    expect(pairedObstacles).toHaveLength(2)
    expect(pairedObstacles[0].obstacleId).not.toBe(
      pairedObstacles[1].obstacleId,
    )
  }

  const preassignedCladEndpoints = srj.connections.flatMap((connection) =>
    connection.pointsToConnect.filter((point) =>
      point.pointId?.startsWith("pcb_port_hole_"),
    ),
  )
  expect(preassignedCladEndpoints).toHaveLength(0)

  const capacityPipeline = new AssignableAutoroutingPipeline2(srj, {
    cacheProvider: null,
  })
  capacityPipeline.solveUntilPhase("portPointPathingSolver")

  expect(capacityPipeline.failed).toBe(false)
  expect(
    capacityPipeline.relateNodesToOffBoardConnections?.nodesInNet.size,
  ).toBe(40)

  const getPointPairIds = (rootConnectionName: string) =>
    capacityPipeline
      .srjWithPointPairs!.connections.filter((connection) =>
        connection.__rootConnectionNames?.includes(rootConnectionName),
      )
      .map((connection) =>
        connection.pointsToConnect.map((point) => point.pointId),
      )
  expect(getPointPairIds("sample_connection_1v1")).toEqual([
    ["pcb_port_sample_U1_pad_50", "pcb_port_sample_C4_pad_1"],
    ["pcb_port_sample_U1_pad_45", "pcb_port_sample_C4_pad_1"],
  ])
  expect(getPointPairIds("sample_connection_3v3")).toContainEqual([
    "pcb_port_sample_U1_pad_48",
    "pcb_port_sample_C3_pad_1",
  ])

  capacityPipeline.solveUntilPhase("multiSectionPortPointOptimizer")
  const pathingAdapter = capacityPipeline.portPointPathingSolver!
  const solver = pathingAdapter.hypergraphSolver!
  const graph = solver.graph
  const connections = solver.connections

  expect(pathingAdapter.usesHypergraph).toBe(true)
  expect(capacityPipeline.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes).toHaveLength(connections.length)

  const offBoardRegions = graph.regions.filter(
    (region) => region.d._offBoardConnectionId,
  )
  expect(offBoardRegions).toHaveLength(40)

  const routesUsingPrefabConnections = solver.solvedRoutes.filter((route) =>
    route.path.some((candidate) =>
      Boolean(candidate.lastRegion?.d._offBoardConnectionId),
    ),
  )
  expect(routesUsingPrefabConnections.length).toBeGreaterThan(0)
  expect(
    routesUsingPrefabConnections.some(
      (route) => route.connection.connectionId === "sample_connection_usb_dm_a",
    ),
  ).toBe(true)

  const downstreamNodes = pathingAdapter.getNodesWithPortPoints()
  expect(
    downstreamNodes.some((node) =>
      node.capacityMeshNodeId.startsWith("offboard:"),
    ),
  ).toBe(false)
  const physicalPortalNodeIds = new Set(
    capacityPipeline
      .capacityNodes!.filter((node) => node._offBoardConnectionId)
      .map((node) => node.capacityMeshNodeId),
  )
  const usedPhysicalPortalNodes = downstreamNodes.filter((node) =>
    physicalPortalNodeIds.has(node.capacityMeshNodeId),
  )
  const usedPrefabPortalIds = new Set(
    routesUsingPrefabConnections.flatMap((route) =>
      route.path.flatMap((candidate) =>
        candidate.lastRegion?.d._offBoardConnectionId
          ? [candidate.lastRegion.d._offBoardConnectionId]
          : [],
      ),
    ),
  )
  expect(usedPhysicalPortalNodes).toHaveLength(usedPrefabPortalIds.size * 2)
  expect(
    usedPhysicalPortalNodes.every((node) => node.portPoints.length >= 2),
  ).toBe(true)

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

  const outputDifferentNetCrossings = solver
    .getOutput()
    .nodesWithPortPoints.filter(
      (node) => !node.capacityMeshNodeId.startsWith("offboard:"),
    )
    .flatMap((node) => {
      const pairs = Array.from(
        Map.groupBy(
          node.portPoints,
          (point) =>
            `${point.connectionName}::${point.rootConnectionName ?? point.connectionName}`,
        ),
      ).flatMap(([key, points]) =>
        points.length >= 2
          ? [
              {
                key,
                rootConnectionName: points[0]!.rootConnectionName,
                point1: points[0]!,
                point2: points[1]!,
              },
            ]
          : [],
      )
      return pairs.flatMap((pair, pairIndex) =>
        pairs.slice(pairIndex + 1).flatMap((otherPair) => {
          if (pair.rootConnectionName === otherPair.rootConnectionName) {
            return []
          }
          return doPointPairsCrossInRegion(
            node,
            pair.point1,
            pair.point2,
            otherPair.point1,
            otherPair.point2,
          )
            ? [`${node.capacityMeshNodeId}:${pair.key}:${otherPair.key}`]
            : []
        }),
      )
    })
  expect(outputDifferentNetCrossings).toEqual([])

  expect(
    getSvgFromGraphicsObject(solver.visualize(), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)

  capacityPipeline.solve()
  expect(capacityPipeline.solved).toBe(true)
  expect(capacityPipeline.failed).toBe(false)
  expect(
    capacityPipeline.getOutputSimplifiedPcbTraces().length,
  ).toBeGreaterThan(0)
}, 20_000)
