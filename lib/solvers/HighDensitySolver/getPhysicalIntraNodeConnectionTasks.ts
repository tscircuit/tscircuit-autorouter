import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

export type PhysicalIntraNodeConnectionTask = {
  connectionName: string
  rootConnectionName?: string
  points: [PortPoint, PortPoint]
}

type PhysicalIntraNodeTaskInput = {
  nodeWithPortPoints: NodeWithPortPoints
  canonicalNetIdByConnectionName: ReadonlyMap<string, string>
  connMap?: ConnectivityMap
  layerCount: number
}

/**
 * Native region segments are local obligations, not a tree joining every
 * visit of the same connection inside this node. Validate the complete
 * explicit-pair contract before copying any task for the physical solver.
 */
export function getPhysicalIntraNodeConnectionTasks({
  nodeWithPortPoints,
  canonicalNetIdByConnectionName,
  connMap,
  layerCount,
}: PhysicalIntraNodeTaskInput): PhysicalIntraNodeConnectionTask[] {
  const prefix = `Physical intra-node pairs for "${nodeWithPortPoints.capacityMeshNodeId}"`
  const pairs = nodeWithPortPoints.portPointsInPairs
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error(`${prefix} require nonempty explicit pairs`)
  }
  if (!Array.isArray(nodeWithPortPoints.portPoints)) {
    throw new Error(`${prefix} require an array of source node ports`)
  }
  if (!Number.isSafeInteger(layerCount) || layerCount <= 0) {
    throw new Error(`${prefix} require a positive board layer count`)
  }

  const validatePort = (port: PortPoint): string => {
    if (
      typeof port !== "object" ||
      port === null ||
      typeof port.connectionName !== "string" ||
      port.connectionName.length === 0 ||
      !Number.isFinite(port.x) ||
      !Number.isFinite(port.y) ||
      !Number.isSafeInteger(port.z) ||
      port.z < 0 ||
      port.z >= layerCount
    ) {
      throw new Error(`${prefix} contain an invalid endpoint`)
    }
    for (const identity of [port.portPointId, port.pcb_port_id]) {
      if (
        identity !== undefined &&
        (typeof identity !== "string" || identity.length === 0)
      ) {
        throw new Error(`${prefix} contain an invalid endpoint identity`)
      }
    }
    const canonicalNetId = canonicalNetIdByConnectionName.get(
      port.connectionName,
    )
    if (typeof canonicalNetId !== "string" || canonicalNetId.length === 0) {
      throw new Error(`${prefix} require a canonical connection identity`)
    }
    const identities = [port.connectionName]
    if (port.rootConnectionName !== undefined) {
      if (
        typeof port.rootConnectionName !== "string" ||
        port.rootConnectionName.length === 0
      ) {
        throw new Error(`${prefix} contain an invalid root identity`)
      }
      identities.push(port.rootConnectionName)
    }
    for (const identity of identities) {
      if (identity === canonicalNetId) continue
      const declaredNet = canonicalNetIdByConnectionName.get(identity)
      const mappedNet = connMap
        ? Object.hasOwn(connMap.netMap, identity)
          ? identity
          : connMap.getNetConnectedToId(identity)
        : undefined
      if (
        (declaredNet !== undefined && declaredNet !== canonicalNetId) ||
        (mappedNet !== undefined && mappedNet !== canonicalNetId) ||
        (declaredNet === undefined && mappedNet === undefined)
      ) {
        throw new Error(`${prefix} contain a conflicting electrical identity`)
      }
    }
    // Membership includes physical identity as well as coordinates. Repeated
    // shared endpoints are allowed; source and pair multiplicities can differ.
    return JSON.stringify([
      port.connectionName,
      port.portPointId ?? null,
      port.pcb_port_id ?? null,
      port.x,
      port.y,
      port.z,
    ])
  }

  const sourcePortKeys = new Set<string>()
  for (const port of nodeWithPortPoints.portPoints) {
    sourcePortKeys.add(validatePort(port))
  }
  const coveredPortKeys = new Set<string>()
  const tasks: PhysicalIntraNodeConnectionTask[] = []
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error(`${prefix} contain a malformed pair`)
    }
    const [start, end] = pair
    const startKey = validatePort(start)
    const endKey = validatePort(end)
    if (start.connectionName !== end.connectionName) {
      throw new Error(`${prefix} must preserve each pair's connection identity`)
    }
    if (!sourcePortKeys.has(startKey) || !sourcePortKeys.has(endKey)) {
      throw new Error(`${prefix} contain an endpoint absent from node ports`)
    }
    coveredPortKeys.add(startKey)
    coveredPortKeys.add(endKey)
    tasks.push({
      connectionName: start.connectionName,
      rootConnectionName: start.rootConnectionName ?? end.rootConnectionName,
      points: [{ ...start }, { ...end }],
    })
  }
  for (const sourceKey of sourcePortKeys) {
    if (!coveredPortKeys.has(sourceKey)) {
      throw new Error(`${prefix} leave a node port without a routing obligation`)
    }
  }
  return tasks
}
