import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

/** Transferable fixed copper endpoints in original board coordinates. */
export type MandatoryPortPointIndex = {
  readonly cellSize: number
  readonly buckets: ReadonlyMap<string, readonly PortPoint[]>
}

export function createMandatoryPortPointIndex(nodes: readonly NodeWithPortPoints[]): MandatoryPortPointIndex {
  const cellSize = 1
  const buckets = new Map<string, PortPoint[]>()
  const seen = new Set<string>()
  for (const node of nodes) {
    for (const point of node.portPoints) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isInteger(point.z)) {
        throw new Error("Invalid mandatory port geometry")
      }
      const identity = JSON.stringify([point.portPointId, point.x, point.y, point.z, point.connectionName, point.rootConnectionName])
      if (seen.has(identity)) continue
      seen.add(identity)
      const copy: PortPoint = { x: point.x, y: point.y, z: point.z,
        portPointId: point.portPointId, connectionName: point.connectionName, rootConnectionName: point.rootConnectionName }
      const key = `${Math.floor(point.x / cellSize)},${Math.floor(point.y / cellSize)}`
      const bucket = buckets.get(key) ?? []
      bucket.push(copy)
      buckets.set(key, bucket)
    }
  }
  return { cellSize, buckets }
}

export function queryMandatoryPortPointIndex(index: MandatoryPortPointIndex, bounds: Bounds): readonly PortPoint[] {
  const points: PortPoint[] = [], epsilon = 1e-9
  const minX = Math.floor((bounds.minX - epsilon) / index.cellSize)
  const maxX = Math.floor((bounds.maxX + epsilon) / index.cellSize)
  const minY = Math.floor((bounds.minY - epsilon) / index.cellSize)
  const maxY = Math.floor((bounds.maxY + epsilon) / index.cellSize)
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (const point of index.buckets.get(`${x},${y}`) ?? []) {
        if (point.x >= bounds.minX - epsilon && point.x <= bounds.maxX + epsilon &&
          point.y >= bounds.minY - epsilon && point.y <= bounds.maxY + epsilon) points.push(point)
      }
    }
  }
  return points
}
