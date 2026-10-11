import type Flatbush from "flatbush"
import type { Bounds } from "./repair04Helpers"

type GridStorage = {
  bounds: Bounds
  pitch: number
  columns: number
  rows: number
  boxes: Float64Array
  offsets: Uint32Array
  items: Uint32Array
}

/** Immutable copper broad phase; callers restore their canonical hit order. */
export class ClearanceCopperGridIndex {
  private readonly original: Flatbush
  private readonly bounds: Bounds
  private readonly pitch: number
  private readonly columns: number
  private readonly rows: number
  private readonly boxes: Float64Array
  private readonly offsets: Uint32Array
  private readonly items: Uint32Array
  private readonly visited: Uint32Array
  private queryId = 0

  private constructor(original: Flatbush, storage: GridStorage) {
    this.original = original
    this.bounds = storage.bounds
    this.pitch = storage.pitch
    this.columns = storage.columns
    this.rows = storage.rows
    this.boxes = storage.boxes
    this.offsets = storage.offsets
    this.items = storage.items
    this.visited = new Uint32Array(original.numItems)
  }

  static create(
    original: Flatbush,
    bounds: Bounds,
    pitch = .5,
  ): Pick<Flatbush, "search"> {
    if (original._pos !== original._boxes.length) {
      throw new Error("Data not yet indexed - call index.finish().")
    }
    if (
      !Number.isFinite(pitch) || pitch <= 0 ||
      ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) ||
      bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY ||
      original.numItems > 0x7fff_ffff
    ) return original
    const columns = Math.ceil((bounds.maxX - bounds.minX) / pitch)
    const rows = Math.ceil((bounds.maxY - bounds.minY) / pitch)
    const cellCount = columns * rows
    if (
      !Number.isSafeInteger(cellCount) || cellCount <= 0 ||
      cellCount > 262_144
    ) return original
    // Read the finished tree's exact indexed boxes, including the original
    // outward margins. Restore insertion ids after its Hilbert permutation.
    const boxes = new Float64Array(original.numItems * 4)
    for (let position = 0; position < original.numItems * 4; position += 4) {
      const id = original._indices[position / 4]!
      const target = id * 4
      for (let coordinate = 0; coordinate < 4; coordinate++) {
        const value = original._boxes[position + coordinate]!
        if (!Number.isFinite(value)) return original
        boxes[target + coordinate] = value
      }
      if (boxes[target]! > boxes[target + 2]! || boxes[target + 1]! > boxes[target + 3]!)
        return original
    }
    const ranges = new Int32Array(original.numItems * 4)
    let references = 0
    for (let id = 0; id < original.numItems; id++) {
      const position = id * 4
      if (
        boxes[position + 2]! < bounds.minX || boxes[position + 3]! < bounds.minY ||
        boxes[position]! > bounds.maxX || boxes[position + 1]! > bounds.maxY
      ) {
        ranges[position] = -1
        continue
      }
      const firstX = Math.max(0, Math.min(columns - 1, Math.floor((boxes[position]! - bounds.minX) / pitch)))
      const firstY = Math.max(0, Math.min(rows - 1, Math.floor((boxes[position + 1]! - bounds.minY) / pitch)))
      const lastX = Math.max(0, Math.min(columns - 1, Math.floor((boxes[position + 2]! - bounds.minX) / pitch)))
      const lastY = Math.max(0, Math.min(rows - 1, Math.floor((boxes[position + 3]! - bounds.minY) / pitch)))
      ranges[position] = firstX
      ranges[position + 1] = firstY
      ranges[position + 2] = lastX
      ranges[position + 3] = lastY
      references += (lastX - firstX + 1) * (lastY - firstY + 1)
      // Storage eligibility is independent of the route/search work allowance.
      if (references > 4_000_000) return original
    }
    const cursors = new Uint32Array(cellCount)
    for (let id = 0; id < original.numItems; id++) {
      const position = id * 4
      if (ranges[position] === -1) continue
      for (let y = ranges[position + 1]!; y <= ranges[position + 3]!; y++)
        for (let x = ranges[position]!; x <= ranges[position + 2]!; x++)
          cursors[y * columns + x]++
    }
    const offsets = new Uint32Array(cellCount + 1)
    for (let cell = 0; cell < cellCount; cell++)
      offsets[cell + 1] = offsets[cell]! + cursors[cell]!
    const items = new Uint32Array(references)
    cursors.set(offsets.subarray(0, cellCount))
    for (let id = 0; id < original.numItems; id++) {
      const position = id * 4
      if (ranges[position] === -1) continue
      for (let y = ranges[position + 1]!; y <= ranges[position + 3]!; y++) {
        for (let x = ranges[position]!; x <= ranges[position + 2]!; x++) {
          const cell = y * columns + x
          items[cursors[cell]!] = id
          cursors[cell]++
        }
      }
    }
    return new ClearanceCopperGridIndex(original, {
      bounds: { ...bounds }, pitch, columns, rows, boxes, offsets, items,
    })
  }

  search(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    filter?: Parameters<Flatbush["search"]>[4],
  ): number[] {
    // Long path shortcuts and unusual queries keep the full original tree.
    // Filters can have observable order or side effects, so retain its traversal.
    if (
      filter !== undefined ||
      !Number.isFinite(minX) || !Number.isFinite(minY) ||
      !Number.isFinite(maxX) || !Number.isFinite(maxY) ||
      minX > maxX || minY > maxY ||
      minX < this.bounds.minX || minY < this.bounds.minY ||
      maxX > this.bounds.maxX || maxY > this.bounds.maxY
    ) return this.original.search(minX, minY, maxX, maxY, filter)
    if (++this.queryId > 0xffff_ffff) {
      this.visited.fill(0)
      this.queryId = 1
    }
    const firstX = Math.max(0, Math.min(this.columns - 1, Math.floor((minX - this.bounds.minX) / this.pitch)))
    const firstY = Math.max(0, Math.min(this.rows - 1, Math.floor((minY - this.bounds.minY) / this.pitch)))
    const lastX = Math.max(0, Math.min(this.columns - 1, Math.floor((maxX - this.bounds.minX) / this.pitch)))
    const lastY = Math.max(0, Math.min(this.rows - 1, Math.floor((maxY - this.bounds.minY) / this.pitch)))
    const results: number[] = []
    for (let y = firstY; y <= lastY; y++) {
      for (let x = firstX; x <= lastX; x++) {
        const cell = y * this.columns + x
        for (let position = this.offsets[cell]!; position < this.offsets[cell + 1]!; position++) {
          const id = this.items[position]!
          if (this.visited[id] === this.queryId) continue
          this.visited[id] = this.queryId
          const box = id * 4
          // These are exactly the tree's strict disjointness comparisons; grid
          // bucket overlap alone never determines a narrow-phase candidate.
          if (
            maxX < this.boxes[box]! || maxY < this.boxes[box + 1]! ||
            minX > this.boxes[box + 2]! || minY > this.boxes[box + 3]!
          ) continue
          results.push(id)
        }
      }
    }
    return results
  }
}
