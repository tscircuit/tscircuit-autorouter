import { HighDensityRouteSpatialIndex } from "../../data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "../../data-structures/ObstacleTree"

type Encode = (value: unknown, key?: string) => unknown
type Segment = { segmentId: string; segment: unknown[]; parentRoute: unknown }
type Via = { viaId: string; x: number; y: number; parentRoute: unknown }
type RouteIndexState = {
  CELL_SIZE: number
  maximumCopperRadius: number
  segmentBuckets: Map<string, Segment[]>
  viaBuckets: Map<string, Via[]>
}
type ObstacleIndexState = {
  storage: unknown[]
  idx: { tree?: { data: unknown }; index?: { _boxes: ArrayLike<number>; _indices: ArrayLike<number>; _levelBounds: number[]; nodeSize: number; numItems: number; _pos: number }; items?: unknown[]; shi?: { CELL_SIZE: number; obstacles: unknown[]; buckets: Map<string, Array<[unknown, number]>> } }
}

export function encodeTraceSimplificationIndex(value: unknown, key: string, encode: Encode, identity: (value: object) => number): unknown | undefined {
  if (key === "hdRouteSHI" && value instanceof HighDensityRouteSpatialIndex) {
    const index = value as unknown as RouteIndexState
    return {
      indexId: identity(value), CELL_SIZE: index.CELL_SIZE,
      maximumCopperRadius: index.maximumCopperRadius,
      segmentBuckets: [...index.segmentBuckets].map(([name, segments]) => [name, segments.map(segment => ({
        segmentId: segment.segmentId,
        segment: segment.segment.map(point => encode(point)),
        parentRoute: encode(segment.parentRoute),
      }))]),
      viaBuckets: [...index.viaBuckets].map(([name, vias]) => [name, vias.map(via => ({
        viaId: via.viaId, x: via.x, y: via.y, parentRoute: encode(via.parentRoute),
      }))]),
    }
  }
  if (key === "obstacleSHI" && value instanceof ObstacleSpatialHashIndex) {
    const index = value as unknown as ObstacleIndexState
    const tree = index.idx.shi
    if (value.search !== ObstacleSpatialHashIndex.prototype.search || value.searchArea !== ObstacleSpatialHashIndex.prototype.searchArea) {
      return { kind: "host", hostQuery: true, indexId: identity(value), storage: index.storage.map(obstacle => encode(obstacle)) }
    }
    if (!tree) {
      if (index.idx.tree) return { kind: "rbush", indexId: identity(value), tree: encode(index.idx.tree.data), storage: index.storage.map(obstacle => encode(obstacle)) }
      const flat = index.idx.index
      if (!flat || !index.idx.items) throw new Error("Unrecognized obstacle spatial index")
      if (flat._pos !== flat._boxes.length) throw new Error("Data not yet indexed - call index.finish().")
      return { kind: "flatbush", indexId: identity(value), boxes: Array.from(flat._boxes), indices: Array.from(flat._indices), levelBounds: flat._levelBounds,
        nodeSize: flat.nodeSize, numItems: flat.numItems, items: index.idx.items.map(obstacle => encode(obstacle)), storage: index.storage.map(obstacle => encode(obstacle)) }
    }
    return {
      kind: "native", indexId: identity(value), CELL_SIZE: tree.CELL_SIZE,
      storage: index.storage.map(obstacle => encode(obstacle)),
      obstacles: tree.obstacles.map(obstacle => encode(obstacle)),
      buckets: [...tree.buckets].map(([name, entries]) => [name, entries.map(([obstacle, index]) => [encode(obstacle), index])]),
    }
  }
  return undefined
}

type Decode = (value: unknown, current?: unknown) => any

export function decodeTraceSimplificationIndex(value: any, current: any, decode: Decode, lookup: (id: number) => any, register: (id: number, object: any) => any): any {
  const existing = lookup(value.indexId)
  if (value.hostQuery && existing) return existing
  if (value.$index === "route") {
    const result = existing ?? register(value.indexId, new HighDensityRouteSpatialIndex([]))
    result.CELL_SIZE = value.CELL_SIZE
    result.maximumCopperRadius = value.maximumCopperRadius
    for (const name of ["segmentBuckets", "viaBuckets"]) {
      const buckets = result[name] as Map<string, unknown[]>
      buckets.clear()
      for (const [key, entries] of value[name]) buckets.set(key, entries.map((entry: any) => decode(entry)))
    }
    return result
  }
  const result = existing ?? register(value.indexId, new ObstacleSpatialHashIndex())
  result.storage = decode(value.storage, result.storage)
  if (value.kind === "native") {
    if (!result.idx.shi) result.idx = (new ObstacleSpatialHashIndex() as any).idx
    const tree = result.idx.shi
    tree.CELL_SIZE = value.CELL_SIZE
    tree.obstacles = decode(value.obstacles, tree.obstacles)
    tree.buckets.clear()
    for (const [key, entries] of value.buckets) tree.buckets.set(key, entries.map((entry: any) => [decode(entry[0]), entry[1]]))
  } else if (value.kind === "rbush") {
    if (!result.idx.tree) result.idx = (new ObstacleSpatialHashIndex("rbush") as any).idx
    result.idx.tree.data = decode(value.tree, result.idx.tree.data)
  } else if (value.kind === "flatbush") {
    const items = decode(value.items)
    if (!result.idx.index || result.idx.index.numItems !== value.numItems) {
      result.idx = (new ObstacleSpatialHashIndex("flatbush", items) as any).idx
    }
    const flat = result.idx.index
    flat._boxes.set(value.boxes)
    flat._indices.set(value.indices)
    flat._levelBounds = value.levelBounds.slice()
    flat.nodeSize = value.nodeSize
    flat._pos = value.boxes.length
    result.idx.items = items
    result.idx.currentIndex = items.length
    result.idx.capacity = value.numItems
  } else throw new Error(`Unrecognized native obstacle index kind ${value.kind}`)
  return result
}
