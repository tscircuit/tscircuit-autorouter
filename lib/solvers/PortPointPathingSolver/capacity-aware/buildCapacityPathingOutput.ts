import { distance } from "@tscircuit/math-utils"
import type { CapacityMeshNodeId } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type {
  ConnectionPathResult,
  InputPortPoint,
  PortPointCandidate,
} from "../PortPointPathingSolver"
import { parseCapacityStateId } from "./state-id"
import type {
  CapacityAwarePortPointPathingSolverParams,
  CapacityPathingPlan,
  CapacityRoute,
} from "./types"

export type CapacityPathingOutput = {
  nodesWithPortPoints: NodeWithPortPoints[]
  connectionsWithResults: ConnectionPathResult[]
  assignedPortPoints: Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  >
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>
}

const getRootConnectionName = (route: CapacityRoute): string | undefined =>
  route.connection.simpleRouteConnection.__rootConnectionNames?.[0]

const addNodePair = (
  nodeById: Map<string, NodeWithPortPoints>,
  plan: CapacityPathingPlan,
  regionId: string,
  entryPoint: PortPoint,
  exitPoint: PortPoint,
): void => {
  const region = plan.regionById.get(regionId)!
  let node = nodeById.get(regionId)
  if (!node) {
    node = {
      capacityMeshNodeId: region.regionId,
      center: region.d.center,
      width: region.d.width,
      height: region.d.height,
      availableZ: region.d.availableZ,
      portPoints: [],
      portPointsInPairs: [],
    }
    nodeById.set(regionId, node)
  }

  const entry = {
    ...entryPoint,
    nextPortPointId: exitPoint.portPointId,
  }
  const exit = {
    ...exitPoint,
    prevPortPointId: entryPoint.portPointId,
  }
  node.portPoints.push(entry, exit)
  node.portPointsInPairs!.push([entry, exit])
}

const buildConnectionResult = (
  route: CapacityRoute,
  plan: CapacityPathingPlan,
  assignedPortPoints: CapacityPathingOutput["assignedPortPoints"],
): ConnectionPathResult => {
  const connection = route.connection.simpleRouteConnection
  const rootConnectionName = getRootConnectionName(route)
  const startPoint = connection.pointsToConnect[0]
  const endPoint = connection.pointsToConnect.at(-1)!
  const path: PortPointCandidate[] = []
  const portPoints: PortPoint[] = []
  let previousPoint: { x: number; y: number } | undefined
  let distanceTraveled = 0

  const addCandidate = (candidateInput: {
    currentNodeId: string
    point: { x: number; y: number }
    z: number
    portPoint: InputPortPoint | null
  }) => {
    if (previousPoint) {
      distanceTraveled += distance(previousPoint, candidateInput.point)
    }
    const candidate: PortPointCandidate = {
      // The ordered path array is the reusable result. Search-history links
      // are deliberately omitted so long board routes stay cheap to clone.
      prevCandidate: null,
      portPoint: candidateInput.portPoint,
      currentNodeId: candidateInput.currentNodeId,
      point: candidateInput.point,
      z: candidateInput.z,
      f: distanceTraveled,
      g: distanceTraveled,
      h: 0,
      distanceTraveled,
    }
    path.push(candidate)
    previousPoint = candidateInput.point
  }

  addCandidate({
    currentNodeId: route.connection.startRegion.regionId,
    point: startPoint,
    z: parseCapacityStateId(route.stateIds[0]!).z,
    portPoint: null,
  })

  let portalIndex = 0
  for (let index = 1; index < route.stateIds.length; index++) {
    const previousState = parseCapacityStateId(route.stateIds[index - 1]!)
    const currentState = parseCapacityStateId(route.stateIds[index]!)
    if (previousState.regionId === currentState.regionId) continue

    const resourceId = route.portalResourceIds[portalIndex++]!
    const assignedPort = plan.assignedPortByResourceAndNet.get(
      `${resourceId}|net${route.netId}`,
    )!
    const inputPortPoint: InputPortPoint = {
      portPointId: assignedPort.d.portId,
      x: assignedPort.d.x,
      y: assignedPort.d.y,
      z: assignedPort.d.z,
      connectionNodeIds: [
        assignedPort.region1.regionId,
        assignedPort.region2.regionId,
      ],
      distToCentermostPortOnZ: assignedPort.d.distToCentermostPortOnZ,
      cramped: assignedPort.d.cramped,
    }
    addCandidate({
      currentNodeId: currentState.regionId,
      point: assignedPort.d,
      z: assignedPort.d.z,
      portPoint: inputPortPoint,
    })

    portPoints.push({
      portPointId: assignedPort.d.portId,
      x: assignedPort.d.x,
      y: assignedPort.d.y,
      z: assignedPort.d.z,
      connectionName: connection.name,
      rootConnectionName,
    })
    if (!assignedPortPoints.has(assignedPort.d.portId)) {
      assignedPortPoints.set(assignedPort.d.portId, {
        connectionName: connection.name,
        rootConnectionName,
      })
    }
  }

  for (let index = 0; index < portPoints.length; index++) {
    portPoints[index]!.prevPortPointId = portPoints[index - 1]?.portPointId
    portPoints[index]!.nextPortPointId = portPoints[index + 1]?.portPointId
  }
  addCandidate({
    currentNodeId: route.connection.endRegion.regionId,
    point: endPoint,
    z: parseCapacityStateId(route.stateIds.at(-1)!).z,
    portPoint: null,
  })

  return {
    connection,
    nodeIds: [
      route.connection.startRegion.regionId,
      route.connection.endRegion.regionId,
    ],
    path,
    portPoints,
    straightLineDistance: route.straightLineDistance,
  }
}

export const buildCapacityPathingOutput = (
  params: CapacityAwarePortPointPathingSolverParams,
  plan: CapacityPathingPlan,
): CapacityPathingOutput => {
  const nodeById = new Map<string, NodeWithPortPoints>()
  const assignedPortPoints: CapacityPathingOutput["assignedPortPoints"] =
    new Map()

  for (const route of plan.routes) {
    const connection = route.connection.simpleRouteConnection
    const rootConnectionName = getRootConnectionName(route)
    const startPoint = connection.pointsToConnect[0]
    const endPoint = connection.pointsToConnect.at(-1)!
    const startZ = parseCapacityStateId(route.stateIds[0]!).z
    const endZ = parseCapacityStateId(route.stateIds.at(-1)!).z
    let currentRegionId = route.connection.startRegion.regionId
    let entryPoint: PortPoint = {
      pcb_port_id:
        params.preserveTerminalPcbPortIds && "pcb_port_id" in startPoint
          ? startPoint.pcb_port_id
          : undefined,
      x: startPoint.x,
      y: startPoint.y,
      z: startZ,
      connectionName: connection.name,
      rootConnectionName,
    }

    for (const resourceId of route.portalResourceIds) {
      const resource = plan.portalResources.get(resourceId)!
      const assignedPort = plan.assignedPortByResourceAndNet.get(
        `${resourceId}|net${route.netId}`,
      )!
      const exitPoint: PortPoint = {
        portPointId: assignedPort.d.portId,
        x: assignedPort.d.x,
        y: assignedPort.d.y,
        z: assignedPort.d.z,
        connectionName: connection.name,
        rootConnectionName,
      }
      addNodePair(nodeById, plan, currentRegionId, entryPoint, exitPoint)
      currentRegionId =
        resource.regionIds[0] === currentRegionId
          ? resource.regionIds[1]
          : resource.regionIds[0]
      entryPoint = exitPoint
    }

    addNodePair(nodeById, plan, currentRegionId, entryPoint, {
      pcb_port_id:
        params.preserveTerminalPcbPortIds && "pcb_port_id" in endPoint
          ? endPoint.pcb_port_id
          : undefined,
      x: endPoint.x,
      y: endPoint.y,
      z: endZ,
      connectionName: connection.name,
      rootConnectionName,
    })
  }

  const connectionsWithResults = plan.routes.map((route) =>
    buildConnectionResult(route, plan, assignedPortPoints),
  )
  const nodesWithPortPoints = [...nodeById.values()]
  const nodeAssignedPortPoints = new Map<CapacityMeshNodeId, PortPoint[]>(
    nodesWithPortPoints.map((node) => [
      node.capacityMeshNodeId,
      [...node.portPoints],
    ]),
  )

  return {
    nodesWithPortPoints,
    connectionsWithResults,
    assignedPortPoints,
    nodeAssignedPortPoints,
  }
}
