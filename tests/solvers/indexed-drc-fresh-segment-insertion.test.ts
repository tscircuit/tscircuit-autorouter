import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import { readFileSync } from "node:fs"

// Frozen current-generation original hash and dynamic builder. Ordinary
// insertion, cell traversal, and engine geometry retain an independent oracle.
const frozenSource = String.raw`
const expandBounds = (bounds: Bounds, amount: number): Bounds => ({
  minX: bounds.minX - amount,
  minY: bounds.minY - amount,
  maxX: bounds.maxX + amount,
  maxY: bounds.maxY + amount,
})

const getSegmentBounds = (segment: TraceSegment): Bounds =>
  expandBounds(
    {
      minX: Math.min(segment.start.x, segment.end.x),
      minY: Math.min(segment.start.y, segment.end.y),
      maxX: Math.max(segment.start.x, segment.end.x),
      maxY: Math.max(segment.start.y, segment.end.y),
    },
    segment.width / 2,
  )

const getViaBounds = (via: Via): Bounds => {
  const radius = via.diameter / 2
  return {
    minX: via.x - radius,
    minY: via.y - radius,
    maxX: via.x + radius,
    maxY: via.y + radius,
  }
}

class SpatialHash<T> {
  private readonly cells = new Map<number, Map<number, SpatialHashCell>>()
  private readonly itemIds = new Map<T, number>()
  private readonly rowItems: T[] = []
  private readonly rowBounds: Bounds[] = []
  private visitedGenerations = new Uint32Array(0)
  private queryGeneration = 0
  private buildGeneration = 1
  private activeCells: SpatialHashCell[] = []
  private previousCells: SpatialHashCell[] = []

  constructor(private readonly cellSize: number) {}

  reset(): void {
    this.itemIds.clear()
    this.rowItems.length = 0
    this.rowBounds.length = 0
    const previousCells = this.previousCells
    this.previousCells = this.activeCells
    this.activeCells = previousCells
    this.activeCells.length = 0
    this.buildGeneration = (this.buildGeneration + 1) >>> 0
    if (this.buildGeneration === 0) this.buildGeneration = 1
  }

  finishBuild(): boolean {
    // Retain cell arrays only where consecutive candidates occupy the same
    // cells. Removed layers and moved copper do not accumulate historical data.
    for (const cell of this.previousCells) {
      if (cell.generation === this.buildGeneration) continue
      const column = this.cells.get(cell.cellX)!
      column.delete(cell.cellY)
      if (column.size === 0) this.cells.delete(cell.cellX)
    }
    this.previousCells.length = 0
    if (this.visitedGenerations.length > Math.max(16, this.rowItems.length * 4)) {
      this.visitedGenerations = new Uint32Array(
        Math.max(16, this.rowItems.length * 2),
      )
    }
    return this.rowItems.length > 0
  }

  private registerItem(item: T, bounds: Bounds): number {
    const itemBounds = { ...bounds }
    const existingId = this.itemIds.get(item)
    if (existingId !== undefined) {
      const existingBounds = this.rowBounds[existingId]!
      existingBounds.minX = Math.min(existingBounds.minX, itemBounds.minX)
      existingBounds.minY = Math.min(existingBounds.minY, itemBounds.minY)
      existingBounds.maxX = Math.max(existingBounds.maxX, itemBounds.maxX)
      existingBounds.maxY = Math.max(existingBounds.maxY, itemBounds.maxY)
      return existingId
    }

    const itemId = this.rowItems.length
    if (itemId >= this.visitedGenerations.length) {
      const generations = new Uint32Array(
        this.visitedGenerations.length === 0
          ? 16
          : this.visitedGenerations.length * 2,
      )
      generations.set(this.visitedGenerations)
      this.visitedGenerations = generations
    }
    this.itemIds.set(item, itemId)
    // Set iteration canonicalizes primitive negative zero to positive zero.
    this.rowItems.push(item === 0 ? (0 as T) : item)
    this.rowBounds.push(itemBounds)
    return itemId
  }

  insert(item: T, bounds: Bounds): void {
    const minCellX = Math.floor(bounds.minX / this.cellSize)
    const maxCellX = Math.floor(bounds.maxX / this.cellSize)
    const minCellY = Math.floor(bounds.minY / this.cellSize)
    const maxCellY = Math.floor(bounds.maxY / this.cellSize)
    let itemId: number | undefined

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      let column = this.cells.get(cellX)
      if (!column && minCellY <= maxCellY) {
        column = new Map<number, SpatialHashCell>()
        this.cells.set(cellX, column)
      }
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        let cell = column!.get(cellY)
        if (!cell) {
          cell = { cellX, cellY, generation: this.buildGeneration, itemIds: [] }
          column!.set(cellY, cell)
          this.activeCells.push(cell)
        } else if (cell.generation !== this.buildGeneration) {
          cell.generation = this.buildGeneration
          cell.itemIds.length = 0
          this.activeCells.push(cell)
        }
        if (itemId === undefined) itemId = this.registerItem(item, bounds)
        cell.itemIds.push(itemId)
      }
    }
  }

  query(bounds: Bounds): T[] {
    const minCellX = Math.floor(bounds.minX / this.cellSize)
    const maxCellX = Math.floor(bounds.maxX / this.cellSize)
    const minCellY = Math.floor(bounds.minY / this.cellSize)
    const maxCellY = Math.floor(bounds.maxY / this.cellSize)
    let generation = this.queryGeneration + 1
    if (generation > 0xffffffff) {
      this.visitedGenerations.fill(0)
      generation = 1
    }
    this.queryGeneration = generation
    const results: T[] = []

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      const column = this.cells.get(cellX)
      // Keep the original loop for nonprogressing infinite/unsafe endpoints.
      if (
        !column &&
        minCellY >= -9007199254740991 &&
        maxCellY <= 9007199254740991
      ) {
        continue
      }
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const cell = column?.get(cellY)
        if (!cell || cell.generation !== this.buildGeneration) continue
        for (const itemId of cell.itemIds) {
          if (this.visitedGenerations[itemId] === generation) continue
          this.visitedGenerations[itemId] = generation
          const itemBounds = this.rowBounds[itemId]!
          // A shared grid cell is only a coarse candidate. Copper and clearance
          // are already included in the inserted bounds, so strict separation
          // cannot hide a violation and surviving items keep their cell order.
          if (
            itemBounds.maxX < bounds.minX ||
            itemBounds.minX > bounds.maxX ||
            itemBounds.maxY < bounds.minY ||
            itemBounds.minY > bounds.maxY
          ) {
            continue
          }
          results.push(this.rowItems[itemId]!)
        }
      }
    }

    return results
  }
}

function originalBuildDynamicIndexes(
    this: any,
    segments: TraceSegment[],
    vias: Via[],
  ): Map<string, SpatialHash<DynamicCollidable>> {
    const indexes = this.dynamicIndexesByLayer
    for (const index of indexes.values()) index.reset()
    const addToLayer = (
      layer: string,
      item: DynamicCollidable,
      bounds: Bounds,
    ) => {
      let index = indexes.get(layer)
      if (!index) {
        index = new SpatialHash<DynamicCollidable>(this.cellSize)
        indexes.set(layer, index)
      }
      index.insert(item, expandBounds(bounds, this.traceClearance))
    }

    for (const segment of segments) {
      addToLayer(segment.layer, segment, getSegmentBounds(segment))
    }
    for (const via of vias) {
      for (const layer of via.layers) {
        addToLayer(layer, via, getViaBounds(via))
      }
    }

    for (const [layer, index] of indexes) {
      if (!index.finishBuild()) indexes.delete(layer)
    }
    return indexes
  }

`
const transpiler = new Bun.Transpiler({ loader: "ts" })
const original = new Function(
  transpiler.transformSync(frozenSource) +
    "\nreturn { Hash: SpatialHash, build: originalBuildDynamicIndexes };",
)()
function getCurrentHash(): any {
  const path =
    process.env.REPAIR03_FRESH_TEST_SOURCE_PATH ??
    Bun.resolveSync(
      "high-density-repair03/lib/drc/AutoroutingDrcEngine",
      process.cwd(),
    )
  const source = readFileSync(path, "utf8")
  const hash = source.slice(
    source.indexOf("class SpatialHash<T>"),
    source.indexOf("const getClosestPointBetweenSegments ="),
  )
  return new Function(
    transpiler.transformSync(hash) + "\nreturn SpatialHash;",
  )()
}
function bounds(minX: number, minY: number, maxX: number, maxY: number): any {
  return { minX, minY, maxX, maxY }
}
function wire(x: number, y: number, layer = "top", width = 0.15): any {
  return { route_type: "wire", x, y, layer, width }
}
function trace(id: string, name: string, route: any[]): any {
  return { pcb_trace_id: id, connection_name: name, route }
}

test("fresh dynamic segment insertion preserves query order, ordinary duplicates, generations, and actual engine errors", () => {
  const CurrentHash = getCurrentHash()
  const queries = [
    bounds(-3, -3, 4, 4),
    bounds(0, 0, 0.2, 0.2),
    bounds(2.5, 2.5, 3.2, 3.2),
    bounds(5, 5, 5.1, 5.1),
    bounds(-2, 0, -1, 1),
    bounds(NaN, 0, 1, 1),
  ]
  const ordinary: any = new CurrentHash(1)
  const reference: any = new original.Hash(1)
  const object = { name: "duplicate" }
  const first = bounds(0, 0, 0.2, 0.2)
  for (const index of [ordinary, reference]) {
    index.insert(object, first)
    index.insert(object, bounds(3, 3, 3.2, 3.2))
    index.insert(-0, bounds(-2, 0, -1, 1))
    index.insert(NaN, bounds(1, 1, 2, 2))
    index.insert(NaN, bounds(2, 2, 3, 3))
    index.finishBuild()
  }
  first.maxX = 100
  for (const query of queries)
    expect(ordinary.query(query)).toEqual(reference.query(query))
  expect(Object.is(ordinary.query(bounds(-2, 0, -1, 1))[0], 0)).toBe(true)
  expect(ordinary.rowItems.length).toBe(reference.rowItems.length)

  const fresh: any = new CurrentHash(1)
  const old: any = new original.Hash(1)
  const items = Array.from({ length: 30 }, (_, id): any => ({ id }))
  for (let round = 0; round < 9; round++) {
    fresh.reset()
    old.reset()
    for (const [id, item] of items.entries()) {
      const x = (id % 7) - 3 + (round % 3)
      const y = Math.floor(id / 7) - 2
      const extent = bounds(x, y, x + 1.5, y + 0.4)
      fresh.insertFresh(item, extent)
      old.insert(item, extent)
    }
    const invalid = [
      bounds(NaN, 0, 1, 1),
      bounds(0, NaN, 1, 1),
      bounds(Infinity, 0, -Infinity, 1),
      bounds(2, 0, 1, 1),
      bounds(0, 2, 1, 1),
    ]
    for (const extent of invalid) {
      fresh.insertFresh({ invalid: true }, extent)
      old.insert({ invalid: true }, extent)
    }
    expect(fresh.rowItems.length).toBe(items.length)
    expect(old.rowItems.length).toBe(items.length)
    fresh.finishBuild()
    old.finishBuild()
    fresh.queryGeneration = old.queryGeneration = 0xffffffff
    for (const query of queries)
      expect(fresh.query(query)).toEqual(old.query(query))
    expect(fresh.activeCells.length).toBe(old.activeCells.length)
    expect(fresh.previousCells.length).toBe(0)
  }
  fresh.reset()
  old.reset()
  const privateBounds = bounds(5, 5, 5.1, 5.1)
  fresh.insertFresh(items[0], privateBounds)
  old.insert(items[0], privateBounds)
  expect(fresh.rowBounds[0]).toBe(privateBounds)
  expect(fresh.itemIds.size).toBe(0)
  fresh.finishBuild()
  old.finishBuild()
  for (const query of queries)
    expect(fresh.query(query)).toEqual(old.query(query))
  fresh.buildGeneration = old.buildGeneration = 0xffffffff
  fresh.reset()
  old.reset()
  fresh.insertFresh(items[1], bounds(0, 0, 0.2, 0.2))
  old.insert(items[1], bounds(0, 0, 0.2, 0.2))
  fresh.finishBuild()
  old.finishBuild()
  expect(fresh.buildGeneration).toBe(1)
  for (const query of queries)
    expect(fresh.query(query)).toEqual(old.query(query))

  const srj: any = {
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    connections: [
      { name: "a", pointsToConnect: [] },
      { name: "b", pointsToConnect: [] },
      { name: "alias", rootConnectionName: "a", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 1, y: 1 },
        width: 0.4,
        height: 0.7,
        layers: ["top", "bottom"],
        connectedTo: ["pcb_smtpad_1"],
        ccwRotationDegrees: 30,
      },
    ],
  }
  const a: any = new AutoroutingDrcEngine(structuredClone(srj), {
    includeTraceViaOwnerMetadata: true,
    spatialCellSize: 0.5,
  })
  const b: any = new AutoroutingDrcEngine(structuredClone(srj), {
    includeTraceViaOwnerMetadata: true,
    spatialCellSize: 0.5,
  })
  b.buildDynamicIndexes = original.build
  const routes = [
    trace("ta", "a", [wire(-2, 0), wire(2, 0)]),
    trace("tb", "b", [
      wire(0, -2),
      wire(0, 2),
      {
        route_type: "via",
        x: 0,
        y: 2,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
      },
      wire(0, 2, "bottom"),
      wire(1, 1, "bottom"),
    ]),
    trace("tc", "alias", [wire(-2, 0.05), wire(2, 0.05)]),
  ]
  for (let round = 0; round < 10; round++) {
    routes[0].route[1].x = round % 2 ? -1 : 2
    routes[2].route[0].layer = round % 3 ? "top" : "bottom"
    routes[2].route[1].layer = routes[2].route[0].layer
    routes[2].route[0].width = round % 2 ? 0.3 : 0.15
    const candidate = a.evaluate(routes)
    const baseline = b.evaluate(routes)
    expect(candidate).toEqual(baseline)
    expect(a.lastRunStats).toEqual(b.lastRunStats)
    for (const layer of ["top", "bottom"]) {
      for (const query of queries) {
        const itemSignature = (items: any[]): any =>
          items.map((item): any => [
            item.kind,
            item.order,
            item.traceId,
            item.kind === "via" ? item.viaId : item.start,
            item.kind === "via" ? item.x : item.end,
          ])
        expect(
          itemSignature(a.dynamicIndexesByLayer.get(layer)?.query(query) ?? []),
        ).toEqual(
          itemSignature(b.dynamicIndexesByLayer.get(layer)?.query(query) ?? []),
        )
      }
    }
  }
  routes[0].route[1].x = NaN
  expect(a.evaluate(routes)).toEqual(b.evaluate(routes))
})
