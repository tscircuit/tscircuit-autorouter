import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

type Context = {
  nodes: readonly NodeWithPortPoints[]
  connMap: ConnectivityMap
  minimumCenterDistance: number
  layerCount: number
}
type Entry = { id: string; owner: string; x: number; y: number; z: number }
const EPSILON = 1e-9

/** Checks and commits each complete placement proposal against current copper. */
export function createPortPointFamilyPositionGuard(context: Context): (points: readonly PortPoint[]) => boolean {
  const distance = context.minimumCenterDistance
  const connMap = context.connMap, layerCount = context.layerCount
  if (!Number.isFinite(distance) || distance <= 0 ||
    !Number.isInteger(layerCount) || layerCount < 1) {
    throw new Error("Invalid used-port clearance geometry")
  }
  const entries = new Map<string, Entry>()
  const buckets = new Map<string, Set<string>>()
  const canonicalNetIds = new Set(Object.keys(connMap.netMap))
  const ownerOf = (point: PortPoint): string => {
    const net = connMap.getNetConnectedToId(point.connectionName)
    if (net !== undefined) return JSON.stringify(["registered", net])
    if (point.rootConnectionName !== undefined) {
      // Output metadata may already contain the canonical network key. That
      // key can also be a literal alias in another network; do not resolve it twice.
      if (canonicalNetIds.has(point.rootConnectionName)) {
        return JSON.stringify(["registered", point.rootConnectionName])
      }
      const rootNet = connMap.getNetConnectedToId(point.rootConnectionName)
      return JSON.stringify(rootNet === undefined
        ? ["literal", point.rootConnectionName] : ["registered", rootNet])
    }
    return JSON.stringify(["literal", point.connectionName])
  }
  const entryOf = (point: PortPoint): Entry => {
    if (!point.portPointId || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      !Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount) {
      throw new Error("Invalid used port point for mutual clearance")
    }
    return { id: point.portPointId, owner: ownerOf(point), x: point.x, y: point.y, z: point.z }
  }
  const bucketKey = (point: Entry): string =>
    `${point.z},${Math.floor(point.x / distance)},${Math.floor(point.y / distance)}`
  const hasConflict = (point: Entry, moving: ReadonlySet<string>): boolean => {
    const gx = Math.floor(point.x / distance), gy = Math.floor(point.y / distance)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of buckets.get(`${point.z},${gx + dx},${gy + dy}`) ?? []) {
          if (moving.has(id)) continue
          const peer = entries.get(id)!
          if (peer.owner !== point.owner && Math.hypot(peer.x - point.x, peer.y - point.y) + EPSILON < distance) return true
        }
      }
    }
    return false
  }
  const insert = (point: Entry): void => {
    const key = bucketKey(point)
    const bucket = buckets.get(key) ?? new Set<string>()
    bucket.add(point.id)
    buckets.set(key, bucket)
    entries.set(point.id, point)
  }
  const noMovingIds = new Set<string>()
  for (const node of context.nodes) {
    for (const point of node.portPoints) {
      const entry = entryOf(point), existing = entries.get(entry.id)
      if (existing) {
        if (entry.owner !== existing.owner || entry.x !== existing.x || entry.y !== existing.y || entry.z !== existing.z) {
          throw new Error(`Inconsistent original used port ${entry.id}`)
        }
        continue
      }
      if (hasConflict(entry, noMovingIds)) {
        throw new Error(`Original used port ${entry.id} violates inter-net copper clearance`)
      }
      insert(entry)
    }
  }
  return (points: readonly PortPoint[]): boolean => {
    const proposals = points.map(entryOf)
    const moving = new Set(proposals.map((point) => point.id))
    if (moving.size !== proposals.length) throw new Error("Duplicate port in atomic placement proposal")
    for (let i = 0; i < proposals.length; i++) {
      const point = proposals[i]!, original = entries.get(point.id)
      if (!original || original.owner !== point.owner || original.z !== point.z) {
        throw new Error(`Atomic placement changed the identity of port ${point.id}`)
      }
      if (hasConflict(point, moving)) return false
      for (let j = 0; j < i; j++) {
        const peer = proposals[j]!
        if (peer.z === point.z && peer.owner !== point.owner &&
          Math.hypot(peer.x - point.x, peer.y - point.y) + EPSILON < distance) return false
      }
    }
    // All old positions remain indexed until the complete batch is admissible.
    for (const point of proposals) {
      const original = entries.get(point.id)!, key = bucketKey(original), bucket = buckets.get(key)!
      bucket.delete(point.id)
      if (bucket.size === 0) buckets.delete(key)
    }
    for (const point of proposals) insert(point)
    return true
  }
}
