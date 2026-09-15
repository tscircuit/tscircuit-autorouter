import { pointToBoxDistance } from "@tscircuit/math-utils"
import type {
  CapacityMeshNode,
  ConnectionPoint,
  SimpleRouteJson,
} from "lib/types"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import { DSU } from "lib/utils/dsu"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { SegmentPortPoint } from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver"

type GetNecessaryCrampedPortPointsInput = {
  capacityMeshNodes: CapacityMeshNode[]
  portPoints: SegmentPortPoint[]
  retainedPortPoints: ReadonlySet<SegmentPortPoint>
  simpleRouteJson: SimpleRouteJson
}

function getTerminalFreeRegions(params: {
  point: ConnectionPoint
  capacityMeshNodes: CapacityMeshNode[]
  nodeMap: ReadonlyMap<string, CapacityMeshNode>
  connectedRegions: DSU
  nodePortPoints: Map<string, SegmentPortPoint[]>
  retainedPortPoints: ReadonlySet<SegmentPortPoint>
  layerCount: number
}): Set<string> {
  const pointZs = getConnectionPointLayers(params.point).map((layer) =>
    mapLayerNameToZ(layer, params.layerCount),
  )
  const regions = new Set<string>()
  for (const node of params.capacityMeshNodes) {
    if (
      pointToBoxDistance(params.point, node) > 0 ||
      !node.availableZ.some((z) => pointZs.includes(z))
    ) {
      continue
    }
    if (!node._containsObstacle) {
      regions.add(params.connectedRegions.find(node.capacityMeshNodeId))
      continue
    }
    for (const portPoint of
      params.nodePortPoints.get(node.capacityMeshNodeId) ?? []) {
      if (portPoint.cramped && !params.retainedPortPoints.has(portPoint)) continue
      for (const nodeId of portPoint.nodeIds) {
        const exitNode = params.nodeMap.get(nodeId)
        if (exitNode && !exitNode._containsObstacle) {
          regions.add(params.connectedRegions.find(nodeId))
        }
      }
    }
  }
  return regions
}

export function getNecessaryCrampedPortPoints(
  input: GetNecessaryCrampedPortPointsInput,
): Set<SegmentPortPoint> {
  const nodeMap = new Map(
    input.capacityMeshNodes.map((node) => [node.capacityMeshNodeId, node]),
  )
  const freePortPoints = input.portPoints.filter((portPoint) =>
    portPoint.nodeIds.every((nodeId) => {
      const node = nodeMap.get(nodeId)
      if (!node) throw new Error(`Could not find capacity mesh node ${nodeId}`)
      return !node._containsObstacle
    }),
  )
  const connectedRegions = new DSU(
    input.capacityMeshNodes
      .filter((node) => !node._containsObstacle)
      .map((node) => node.capacityMeshNodeId),
  )
  const nodePortPoints = new Map<string, SegmentPortPoint[]>()
  for (const portPoint of input.portPoints) {
    for (const nodeId of portPoint.nodeIds) {
      const existingPortPoints = nodePortPoints.get(nodeId) ?? []
      existingPortPoints.push(portPoint)
      nodePortPoints.set(nodeId, existingPortPoints)
    }
  }
  for (const portPoint of freePortPoints) {
    if (!portPoint.cramped || input.retainedPortPoints.has(portPoint)) {
      connectedRegions.union(...portPoint.nodeIds)
    }
  }

  // Non-cramped ports define the normal free-space components. For each
  // declared connection, retain only the cramped path needed to join the
  // components containing its terminals.
  const necessaryPortPoints = new Set<SegmentPortPoint>()
  for (const connection of input.simpleRouteJson.connections) {
    const terminalRegions = connection.pointsToConnect.map((point) =>
      getTerminalFreeRegions({
        point,
        capacityMeshNodes: input.capacityMeshNodes,
        nodeMap,
        connectedRegions,
        nodePortPoints,
        retainedPortPoints: input.retainedPortPoints,
        layerCount: input.simpleRouteJson.layerCount,
      }),
    )
    let sourceRegions = terminalRegions[0]
    if (!sourceRegions || sourceRegions.size === 0) continue
    for (const targetRegions of terminalRegions.slice(1)) {
      if (targetRegions.size === 0) continue
      sourceRegions = new Set(
        [...sourceRegions].map((region) => connectedRegions.find(region)),
      )
      const targets = new Set(
        [...targetRegions].map((region) => connectedRegions.find(region)),
      )
      if ([...sourceRegions].some((region) => targets.has(region))) {
        sourceRegions = new Set([...sourceRegions, ...targets])
        continue
      }

      const adjacency = new Map<string, SegmentPortPoint[]>()
      for (const portPoint of freePortPoints) {
        for (const nodeId of portPoint.nodeIds) {
          const region = connectedRegions.find(nodeId)
          const regionPortPoints = adjacency.get(region) ?? []
          regionPortPoints.push(portPoint)
          adjacency.set(region, regionPortPoints)
        }
      }
      const parents = new Map<
        string,
        { from: string; portPoint: SegmentPortPoint } | null
      >([...sourceRegions].map((region) => [region, null]))
      const queue = [...sourceRegions]
      let reachedTarget: string | undefined
      for (let index = 0; index < queue.length; index++) {
        const from = queue[index]!
        if (targets.has(from)) {
          reachedTarget = from
          break
        }
        for (const portPoint of adjacency.get(from) ?? []) {
          for (const nodeId of portPoint.nodeIds) {
            const to = connectedRegions.find(nodeId)
            if (parents.has(to)) continue
            parents.set(to, { from, portPoint })
            queue.push(to)
          }
        }
      }
      if (reachedTarget === undefined) continue
      let current = reachedTarget
      while (parents.get(current)) {
        const parent = parents.get(current)!
        if (parent.portPoint.cramped) necessaryPortPoints.add(parent.portPoint)
        connectedRegions.union(...parent.portPoint.nodeIds)
        current = parent.from
      }
      sourceRegions = new Set(
        [...sourceRegions, ...targets].map((region) =>
          connectedRegions.find(region),
        ),
      )
    }
  }
  return necessaryPortPoints
}
