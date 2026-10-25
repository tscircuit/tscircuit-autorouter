export type ReversePotentialGeometry = {
  key: string
  columns: number
  rows: number
  layers: readonly number[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  pitchX: number
  pitchY: number
  planarStepCost: number
  viaStepCost: number
  goals: Uint8Array
}

export type ReversePotentialContext = {
  signature: string
  planarCosts: Float64Array
  viaCosts: Float64Array
  blocked: Uint8Array
}

type Field = {
  generation: number
  key: string
  geometry: ReversePotentialGeometry
  geometryKey: string
  context: ReversePotentialContext
  g: Float64Array
  rhs: Float64Array
  heap: Int32Array
  positions: Int32Array
  heapSize: number
  bytes: number
}

class ReversePotentialWorkLimit extends Error {}

/** Goal-rooted LPA values belong to immutable context generations, never a route. */
export class ReverseCostToGoCache {
  private readonly fields = new Map<number, Field>()
  private readonly contexts = new Map<string, number>()
  private nextGeneration = 1
  private retainedBytes = 0
  private peakRetainedBytes = 0
  private work = 0
  private workCharger?: (workUnits: number) => void

  constructor(
    readonly diagnostics: Record<string, number>,
    readonly maxBytes = 512 * 1024,
    readonly maxWorkPerPrepare = 100_000,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
      throw new Error("Invalid reverse potential memory allowance")
    if (!Number.isSafeInteger(maxWorkPerPrepare) || maxWorkPerPrepare < 0)
      throw new Error("Invalid reverse potential work allowance")
  }

  get memoryBytes(): number {
    return this.retainedBytes
  }

  private charge(units = 1): void {
    // Reserve each quantum before executing it. A parent budget exception must
    // propagate; only this cache's own bounded-work exception is recoverable.
    const nextWork = this.work + units
    const quanta = Math.ceil(Math.min(nextWork, this.maxWorkPerPrepare) / 64) - Math.ceil(this.work / 64)
    if (quanta > 0) {
      this.workCharger?.(quanta)
      this.diagnostics.reversePotentialChargedWorkUnits =
        (this.diagnostics.reversePotentialChargedWorkUnits ?? 0) + quanta
    }
    this.work = nextWork
    if (this.work > this.maxWorkPerPrepare)
      throw new ReversePotentialWorkLimit("Reverse field work allowance")
    this.diagnostics.reversePotentialRepairWork =
      (this.diagnostics.reversePotentialRepairWork ?? 0) + units
  }

  private neighbors(field: Field, index: number, visit: (next: number, via: boolean, diagonal: boolean) => void): void {
    const { columns, rows, layers } = field.geometry
    const plane = columns * rows
    const xy = index % plane
    const column = xy % columns
    const row = Math.floor(xy / columns)
    const layer = Math.floor(index / plane)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dy === 0) || column + dx < 0 || column + dx >= columns || row + dy < 0 || row + dy >= rows) continue
        visit(index + dy * columns + dx, false, dx !== 0 && dy !== 0)
      }
    }
    for (let z = 0; z < layers.length; z++) {
      if (z !== layer) visit(z * plane + xy, true, false)
    }
  }

  private less(field: Field, left: number, right: number): boolean {
    const a = Math.min(field.g[left]!, field.rhs[left]!)
    const b = Math.min(field.g[right]!, field.rhs[right]!)
    if (Number.isNaN(a) || Number.isNaN(b))
      throw new Error("NaN reverse potential queue key")
    return a < b || (a === b && left < right)
  }

  private moveUp(field: Field, position: number): number {
    const value = field.heap[position]!
    while (position > 0) {
      this.charge()
      const parent = (position - 1) >> 1
      const other = field.heap[parent]!
      if (!this.less(field, value, other)) break
      field.heap[position] = other
      field.positions[other] = position
      position = parent
    }
    field.heap[position] = value
    field.positions[value] = position
    return position
  }

  private moveDown(field: Field, position: number): void {
    const value = field.heap[position]!
    while (position * 2 + 1 < field.heapSize) {
      this.charge()
      let child = position * 2 + 1
      if (child + 1 < field.heapSize && this.less(field, field.heap[child + 1]!, field.heap[child]!)) child++
      const other = field.heap[child]!
      if (!this.less(field, other, value)) break
      field.heap[position] = other
      field.positions[other] = position
      position = child
    }
    field.heap[position] = value
    field.positions[value] = position
  }

  private remove(field: Field, index: number): void {
    const position = field.positions[index]!
    if (position < 0) return
    const last = field.heap[--field.heapSize]!
    field.positions[index] = -1
    if (position === field.heapSize) return
    field.heap[position] = last
    field.positions[last] = position
    this.moveDown(field, this.moveUp(field, position))
  }

  private update(field: Field, index: number): void {
    this.charge()
    if (field.geometry.goals[index]) field.rhs[index] = 0
    else {
      let value = Infinity
      if (!field.context.blocked[index]) {
        this.neighbors(field, index, (next, via, diagonal): void => {
          this.charge()
          if (field.context.blocked[next] && !field.geometry.goals[next]) return
          const cost = via
            ? field.geometry.viaStepCost + field.context.viaCosts[next]!
            : field.geometry.planarStepCost * (diagonal ? Math.SQRT2 : 1) + field.context.planarCosts[next]!
          value = Math.min(value, cost + field.g[next]!)
        })
      }
      field.rhs[index] = value
    }
    if (field.g[index] === field.rhs[index]) this.remove(field, index)
    else if (field.positions[index]! >= 0) {
      const at = this.moveUp(field, field.positions[index]!)
      this.moveDown(field, at)
    } else {
      field.heap[field.heapSize] = index
      field.positions[index] = field.heapSize++
      this.moveUp(field, field.heapSize - 1)
    }
  }

  prepare(geometry: ReversePotentialGeometry, context: ReversePotentialContext, chargeWork?: (workUnits: number) => void): number | null {
    this.diagnostics.reversePotentialContexts = (this.diagnostics.reversePotentialContexts ?? 0) + 1
    const count = geometry.columns * geometry.rows * geometry.layers.length
    if (!Number.isSafeInteger(geometry.columns) || geometry.columns <= 0 || !Number.isSafeInteger(geometry.rows) || geometry.rows <= 0 || !Number.isSafeInteger(count) || count <= 0 || count > 2048 || !Number.isFinite(geometry.planarStepCost) || !Number.isFinite(geometry.viaStepCost) || !(geometry.pitchX > 0) || !(geometry.pitchY > 0) || !Number.isFinite(geometry.pitchX) || !Number.isFinite(geometry.pitchY) || geometry.goals.length !== count || context.planarCosts.length !== count || context.viaCosts.length !== count || context.blocked.length !== count || !(geometry.planarStepCost > 0) || !(geometry.viaStepCost > 0))
      throw new Error("Invalid reverse potential graph")
    for (let i = 0; i < count; i++) {
      if (!Number.isFinite(context.planarCosts[i]) || context.planarCosts[i]! < 0 || !Number.isFinite(context.viaCosts[i]) || context.viaCosts[i]! < 0)
        throw new Error("Invalid reverse potential edge cost")
    }
    // The caller namespace cannot hide a changed goal region, grid or dimensions.
    const geometryKey = JSON.stringify([geometry.key, geometry.columns, geometry.rows,
      geometry.layers, geometry.bounds, geometry.pitchX, geometry.pitchY,
      geometry.planarStepCost, geometry.viaStepCost, Array.from(geometry.goals)])
    const key = JSON.stringify([geometryKey, context.signature])
    const existing = this.contexts.get(key)
    if (existing !== undefined) {
      const field = this.fields.get(existing)
      if (!field) throw new Error("Missing reverse potential generation")
      if (context.planarCosts.some((value, i) => value !== field.context.planarCosts[i]) ||
          context.viaCosts.some((value, i) => value !== field.context.viaCosts[i]) ||
          context.blocked.some((value, i) => value !== field.context.blocked[i]))
        throw new Error("Reused reverse context identity with different costs")
      this.fields.delete(existing)
      this.fields.set(existing, field)
      this.diagnostics.reversePotentialCacheHits = (this.diagnostics.reversePotentialCacheHits ?? 0) + 1
      return existing
    }
    const bytes = 1024 + count * 43 + 8 * geometry.layers.length + 2 * (key.length + context.signature.length + geometryKey.length)
    if (bytes > this.maxBytes) {
      this.diagnostics.reversePotentialMemoryBypasses = (this.diagnostics.reversePotentialMemoryBypasses ?? 0) + 1
      return null
    }
    let parent: Field | undefined
    for (const field of this.fields.values()) {
      if (field.geometryKey === geometryKey) parent = field
    }
    const field: Field = {
      generation: this.nextGeneration++, key, geometryKey,
      geometry: { ...geometry, layers: [...geometry.layers], bounds: { ...geometry.bounds }, goals: geometry.goals.slice() },
      context: { ...context, planarCosts: context.planarCosts.slice(), viaCosts: context.viaCosts.slice(), blocked: context.blocked.slice() },
      g: parent ? parent.g.slice() : new Float64Array(count).fill(Infinity),
      rhs: parent ? parent.rhs.slice() : new Float64Array(count).fill(Infinity),
      heap: new Int32Array(count), positions: new Int32Array(count).fill(-1),
      heapSize: 0, bytes,
    }
    this.work = 0
    this.workCharger = chargeWork
    let changed = 0
    try {
      for (let i = 0; i < count; i++) {
        this.charge()
        if (!parent || context.planarCosts[i] !== parent.context.planarCosts[i] || context.viaCosts[i] !== parent.context.viaCosts[i] || context.blocked[i] !== parent.context.blocked[i]) {
          changed++
          this.update(field, i)
          this.neighbors(field, i, (next): void => this.update(field, next))
        }
      }
      while (field.heapSize > 0) {
        const current = field.heap[0]!
        this.remove(field, current)
        if (field.g[current]! > field.rhs[current]!) field.g[current] = field.rhs[current]!
        else {
          field.g[current] = Infinity
          this.update(field, current)
        }
        this.diagnostics.reversePotentialExpandedVertices = (this.diagnostics.reversePotentialExpandedVertices ?? 0) + 1
        this.neighbors(field, current, (next): void => this.update(field, next))
      }
    } catch (error) {
      if (!(error instanceof ReversePotentialWorkLimit)) throw error
      this.diagnostics.reversePotentialWorkBypasses = (this.diagnostics.reversePotentialWorkBypasses ?? 0) + 1
      return null
    } finally {
      this.workCharger = undefined
    }
    while (this.fields.size > 0 && this.retainedBytes + bytes > this.maxBytes) {
      const [id, oldest] = this.fields.entries().next().value!
      this.fields.delete(id)
      this.contexts.delete(oldest.key)
      this.retainedBytes -= oldest.bytes
      this.diagnostics.reversePotentialEvictions = (this.diagnostics.reversePotentialEvictions ?? 0) + 1
    }
    this.fields.set(field.generation, field)
    this.contexts.set(key, field.generation)
    this.retainedBytes += bytes
    const metric = parent ? "reversePotentialRepairs" : "reversePotentialBuilds"
    this.diagnostics[metric] = (this.diagnostics[metric] ?? 0) + 1
    this.diagnostics.reversePotentialChangedCells = (this.diagnostics.reversePotentialChangedCells ?? 0) + changed
    // This additive sum of node-local high-water marks merges identically in
    // serial routing and worker batches, unlike a shared global maximum.
    const nextPeak = Math.max(this.peakRetainedBytes, this.retainedBytes)
    this.diagnostics.reversePotentialNodePeakBytes =
      (this.diagnostics.reversePotentialNodePeakBytes ?? 0) + nextPeak - this.peakRetainedBytes
    this.peakRetainedBytes = nextPeak
    return field.generation
  }

  estimate(generation: number, point: { x: number; y: number; z: number }): number {
    this.diagnostics.reversePotentialQueries = (this.diagnostics.reversePotentialQueries ?? 0) + 1
    const field = this.fields.get(generation)
    if (!field) {
      this.diagnostics.reversePotentialExpiredQueries = (this.diagnostics.reversePotentialExpiredQueries ?? 0) + 1
      return 0
    }
    const { geometry } = field
    const layer = geometry.layers.indexOf(point.z)
    if (layer < 0 || point.x < geometry.bounds.minX || point.x > geometry.bounds.maxX || point.y < geometry.bounds.minY || point.y > geometry.bounds.maxY) return 0
    const column = Math.min(geometry.columns - 1, Math.floor((point.x - geometry.bounds.minX) / geometry.pitchX))
    const row = Math.min(geometry.rows - 1, Math.floor((point.y - geometry.bounds.minY) / geometry.pitchY))
    const index = (layer * geometry.rows + row) * geometry.columns + column
    const value = field.g[index]!
    // No physical failure is inferred from an unreachable relaxed component.
    return Number.isFinite(value) ? Math.max(0, value) : 0
  }
}
