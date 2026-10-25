/**
 * Geometry/cost-event contraction of A13's frozen additive grid.
 *
 * The A13 input contract and move arithmetic are adapted from
 * tscircuit/high-density-a01, revision c6812cebd44b09f29f2fee929837b313b822f2ae.
 * MIT License, Copyright (c) 2026 tscircuit.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions: the above copyright notice and this
 * permission notice shall be included in all copies or substantial portions of
 * the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 * EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
 * OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
 * ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

export type EventTileSearchInputs = {
  traceCost: Uint16Array
  viaCost: Uint16Array
  fixed: Uint8Array
  fixedVia: Uint8Array
  history: Float64Array
  viaHistory: Float64Array
  heuristicCost: Float64Array
  viaAllowed: Uint8Array
}

export type EventTileSearchDiagnostics = {
  queries: number
  compressedQueries: number
  denseStates: number
  eventStates: number
  inputStatesScanned: number
  macroPops: number
  macroExpansions: number
  macroTransitions: number
  reconstructedGridEdges: number
  workUnits: number
}

type SearchResult = { status: number; expansions: number }
type SearchPhase =
  | "idle"
  | "compile"
  | "coordinates"
  | "initialize"
  | "search"
  | "reconstruct"
  | "solved"
  | "unreachable"
  | "budget"

/**
 * Retain both ends of every field-change boundary on every layer, and terminal
 * projections. An omitted row/column run is globally identical, including via
 * permissions/costs. Its rectilinear bends and layer transfers can be shifted to
 * retained coordinates without increasing the additive grid objective. This is
 * a discrete Hanan-style contraction, not continuous PCB completeness: physical
 * self-via/copper validation remains the owning router's responsibility.
 *
 * Inputs must remain unchanged between begin() and a terminal run() result, as
 * required by the original A13 kernel. Every query recompiles all cost events;
 * no occupancy/history cache survives a new begin().
 */
export class EventTileSearchKernel {
  readonly diagnostics: EventTileSearchDiagnostics = {
    queries: 0,
    compressedQueries: 0,
    denseStates: 0,
    eventStates: 0,
    inputStatesScanned: 0,
    macroPops: 0,
    macroExpansions: 0,
    macroTransitions: 0,
    reconstructedGridEdges: 0,
    workUnits: 0,
  }
  private readonly plane: number
  private readonly states: number
  private inputs?: EventTileSearchInputs
  private phase: SearchPhase = "idle"
  private presentCost = 0
  private start = 0
  private goal = 0
  private cursor = 0
  private keepColumns = new Uint8Array(0)
  private keepRows = new Uint8Array(0)
  private columns: number[] = []
  private rows: number[] = []
  private startColumn = 0
  private startRow = 0
  private goalColumn = 0
  private goalRow = 0
  private macroPlane = 0
  private macroStates = 0
  private distance = new Float64Array(0)
  private parent = new Int32Array(0)
  private versions = new Uint32Array(0)
  private heapF: number[] = []
  private heapIndex: number[] = []
  private heapVersion: number[] = []
  private active = -1
  private nextDirection = 0
  private route: number[] = []
  private reconstructionMacro = -1
  private reconstructionCell = -1
  private reconstructionSteps = 0

  constructor(
    private readonly columnCount: number,
    private readonly rowCount: number,
    private readonly layerCount: number,
    private readonly pitchX: number,
    private readonly pitchY: number,
  ) {
    for (const count of [columnCount, rowCount, layerCount]) {
      if (!Number.isSafeInteger(count) || count < 1)
        throw new Error("Event search dimensions must be positive integers")
    }
    if (![pitchX, pitchY].every((pitch) => Number.isFinite(pitch) && pitch > 0))
      throw new Error("Event search pitches must be positive and finite")
    this.plane = columnCount * rowCount
    this.states = this.plane * layerCount
    if (!Number.isSafeInteger(this.states) || this.states > 2_000_000)
      throw new Error("Event search grid exceeds its supported state domain")
  }

  begin(
    inputs: EventTileSearchInputs,
    start: number,
    goal: number,
    presentCost: number,
  ): void {
    for (const state of [start, goal]) {
      if (!Number.isSafeInteger(state) || state < 0 || state >= this.states)
        throw new Error("Event search terminal is outside its grid")
    }
    if (!Number.isFinite(presentCost) || presentCost < 0)
      throw new Error("Event search present cost must be nonnegative")
    const stateArrays = [inputs.traceCost, inputs.fixed, inputs.history, inputs.heuristicCost]
    const planeArrays = [inputs.viaCost, inputs.fixedVia, inputs.viaHistory, inputs.viaAllowed]
    if (
      stateArrays.some((array) => array.length !== this.states) ||
      planeArrays.some((array) => array.length !== this.plane) ||
      !(inputs.traceCost instanceof Uint16Array) ||
      !(inputs.viaCost instanceof Uint16Array) ||
      !(inputs.fixed instanceof Uint8Array) ||
      !(inputs.fixedVia instanceof Uint8Array) ||
      !(inputs.viaAllowed instanceof Uint8Array) ||
      !(inputs.history instanceof Float64Array) ||
      !(inputs.viaHistory instanceof Float64Array) ||
      !(inputs.heuristicCost instanceof Float64Array)
    )
      throw new Error("Unsupported A13 event-search input layout")
    this.inputs = inputs
    this.start = start
    this.goal = goal
    this.presentCost = presentCost
    this.phase = "compile"
    this.cursor = 0
    this.columns = []
    this.rows = []
    this.keepColumns = new Uint8Array(this.columnCount)
    this.keepRows = new Uint8Array(this.rowCount)
    this.keepColumns[0] = this.keepColumns[this.columnCount - 1] = 1
    this.keepRows[0] = this.keepRows[this.rowCount - 1] = 1
    for (const terminal of [start, goal]) {
      const xy = terminal % this.plane
      this.keepColumns[xy % this.columnCount] = 1
      this.keepRows[Math.floor(xy / this.columnCount)] = 1
    }
    this.heapF = []
    this.heapIndex = []
    this.heapVersion = []
    this.active = -1
    this.route = []
    this.reconstructionSteps = 0
    this.diagnostics.queries++
    this.diagnostics.denseStates += this.states
  }

  private inputsOrThrow(): EventTileSearchInputs {
    if (!this.inputs || this.phase === "idle") {
      throw new Error("Event search must begin before it can run")
    }
    return this.inputs
  }

  private sameSignature(a: number, b: number): boolean {
    const input = this.inputsOrThrow()
    const xyA = a % this.plane
    const xyB = b % this.plane
    return (
      input.traceCost[a] === input.traceCost[b] &&
      input.history[a] === input.history[b] &&
      Boolean(input.fixed[a]) === Boolean(input.fixed[b]) &&
      input.viaCost[xyA] === input.viaCost[xyB] &&
      input.viaHistory[xyA] === input.viaHistory[xyB] &&
      Boolean(input.fixedVia[xyA]) === Boolean(input.fixedVia[xyB]) &&
      Boolean(input.viaAllowed[xyA]) === Boolean(input.viaAllowed[xyB])
    )
  }

  private compileState(): void {
    const input = this.inputsOrThrow()
    const index = this.cursor++
    const xy = index % this.plane
    const column = xy % this.columnCount
    const row = Math.floor(xy / this.columnCount)
    if (
      !Number.isFinite(input.history[index]) || input.history[index]! < 0 ||
      !Number.isFinite(input.heuristicCost[index]) || input.heuristicCost[index]! < 0 ||
      !Number.isFinite(input.viaHistory[xy]) || input.viaHistory[xy]! < 0 ||
      !Number.isFinite(this.presentCost * input.traceCost[index]! + input.history[index]!) ||
      !Number.isFinite(this.presentCost * input.viaCost[xy]! + input.viaHistory[xy]!)
    )
      throw new Error("Event search requires finite nonnegative frozen costs")
    if (column > 0 && !this.sameSignature(index, index - 1)) {
      this.keepColumns[column - 1] = this.keepColumns[column] = 1
    }
    if (row > 0 && !this.sameSignature(index, index - this.columnCount)) {
      this.keepRows[row - 1] = this.keepRows[row] = 1
    }
    this.diagnostics.inputStatesScanned++
    if (this.cursor === this.states) {
      this.phase = "coordinates"
      this.cursor = 0
    }
  }

  private collectCoordinate(): void {
    const cursor = this.cursor++
    if (cursor < this.columnCount) {
      if (this.keepColumns[cursor]) {
        const ordinal = this.columns.length
        this.columns.push(cursor)
        if (cursor === this.start % this.columnCount) this.startColumn = ordinal
        if (cursor === this.goal % this.columnCount) this.goalColumn = ordinal
      }
    } else {
      const row = cursor - this.columnCount
      if (this.keepRows[row]) {
        const ordinal = this.rows.length
        this.rows.push(row)
        if (row === Math.floor((this.start % this.plane) / this.columnCount)) this.startRow = ordinal
        if (row === Math.floor((this.goal % this.plane) / this.columnCount)) this.goalRow = ordinal
      }
    }
    if (this.cursor === this.columnCount + this.rowCount) {
      this.macroPlane = this.columns.length * this.rows.length
      this.macroStates = this.macroPlane * this.layerCount
      this.distance = new Float64Array(this.macroStates)
      this.parent = new Int32Array(this.macroStates)
      this.versions = new Uint32Array(this.macroStates)
      this.diagnostics.eventStates += this.macroStates
      if (this.macroStates < this.states) this.diagnostics.compressedQueries++
      this.phase = "initialize"
      this.cursor = 0
    }
  }

  private initializeState(): void {
    this.distance[this.cursor] = Infinity
    this.parent[this.cursor++] = -1
    if (this.cursor !== this.macroStates) return
    const start = Math.floor(this.start / this.plane) * this.macroPlane +
      this.startRow * this.columns.length + this.startColumn
    this.distance[start] = 0
    this.push(start, this.inputsOrThrow().heuristicCost[this.start]!)
    this.phase = "search"
  }

  private gridIndex(macroIndex: number): number {
    const layer = Math.floor(macroIndex / this.macroPlane)
    const xy = macroIndex % this.macroPlane
    const row = this.rows[Math.floor(xy / this.columns.length)]!
    const column = this.columns[xy % this.columns.length]!
    return layer * this.plane + row * this.columnCount + column
  }

  private push(index: number, f: number): void {
    if (!Number.isFinite(f)) throw new Error("Event search priority overflowed its finite cost domain")
    const version = (this.versions[index]! + 1) >>> 0
    this.versions[index] = version
    let position = this.heapF.length
    this.heapF.push(f)
    this.heapIndex.push(index)
    this.heapVersion.push(version)
    while (position > 0) {
      const parent = (position - 1) >> 1
      if (this.heapF[parent]! <= f) break
      this.heapF[position] = this.heapF[parent]!
      this.heapIndex[position] = this.heapIndex[parent]!
      this.heapVersion[position] = this.heapVersion[parent]!
      position = parent
    }
    this.heapF[position] = f
    this.heapIndex[position] = index
    this.heapVersion[position] = version
  }

  private pop(): { index: number; version: number } {
    const result = { index: this.heapIndex[0]!, version: this.heapVersion[0]! }
    const lastF = this.heapF.pop()!
    const lastIndex = this.heapIndex.pop()!
    const lastVersion = this.heapVersion.pop()!
    if (this.heapF.length === 0) return result
    let position = 0
    while (position * 2 + 1 < this.heapF.length) {
      let child = position * 2 + 1
      if (child + 1 < this.heapF.length && this.heapF[child + 1]! < this.heapF[child]!) child++
      if (lastF <= this.heapF[child]!) break
      this.heapF[position] = this.heapF[child]!
      this.heapIndex[position] = this.heapIndex[child]!
      this.heapVersion[position] = this.heapVersion[child]!
      position = child
    }
    this.heapF[position] = lastF
    this.heapIndex[position] = lastIndex
    this.heapVersion[position] = lastVersion
    return result
  }

  private searchUnit(): void {
    const input = this.inputsOrThrow()
    if (this.active < 0) {
      if (this.heapF.length === 0) {
        this.phase = "unreachable"
        return
      }
      const popped = this.pop()
      this.diagnostics.macroPops++
      if (popped.version !== this.versions[popped.index]) return
      this.active = popped.index
      this.diagnostics.macroExpansions++
      if (this.gridIndex(this.active) === this.goal) {
        this.reconstructionMacro = this.active
        this.reconstructionCell = this.goal
        this.route = [this.goal]
        this.phase = "reconstruct"
        return
      }
      this.nextDirection = 0
      return
    }
    const current = this.active
    const direction = this.nextDirection++
    const layer = Math.floor(current / this.macroPlane)
    const xy = current % this.macroPlane
    const x = xy % this.columns.length
    const y = Math.floor(xy / this.columns.length)
    const gridCurrent = this.gridIndex(current)
    let next = -1
    let cost = 0
    let length = 1
    if (direction < 4) {
      const nextX = x + (direction === 0 ? -1 : direction === 1 ? 1 : 0)
      const nextY = y + (direction === 2 ? -1 : direction === 3 ? 1 : 0)
      if (nextX >= 0 && nextX < this.columns.length && nextY >= 0 && nextY < this.rows.length) {
        next = layer * this.macroPlane + nextY * this.columns.length + nextX
        length = direction < 2
          ? Math.abs(this.columns[nextX]! - this.columns[x]!)
          : Math.abs(this.rows[nextY]! - this.rows[y]!)
        const base = direction < 2
          ? this.pitchX * (layer % 2 ? 1.05 : 1)
          : this.pitchY * (layer % 2 ? 1 : 1.05)
        const gridNext = this.gridIndex(next)
        cost = length * (base + this.presentCost * input.traceCost[gridNext]! + input.history[gridNext]!)
        if (input.fixed[gridNext] && (gridNext !== this.goal || length > 1)) next = -1
      }
    } else {
      const targetLayer = direction - 4
      const cell = gridCurrent % this.plane
      if (targetLayer < this.layerCount && targetLayer !== layer && input.viaAllowed[cell] && !input.fixedVia[cell]) {
        next = targetLayer * this.macroPlane + xy
        const gridNext = this.gridIndex(next)
        cost = 0.8 + this.presentCost * input.viaCost[cell]! + input.viaHistory[cell]!
        if (input.fixed[gridNext] && gridNext !== this.goal) next = -1
      }
    }
    if (next >= 0) {
      this.diagnostics.macroTransitions++
      const g = this.distance[current]! + cost
      if (!Number.isFinite(g)) throw new Error("Event search transition overflowed its finite cost domain")
      if (g < this.distance[next]!) {
        this.distance[next] = g
        this.parent[next] = current
        this.push(next, g + input.heuristicCost[this.gridIndex(next)]!)
      }
    }
    if (this.nextDirection === 4 + this.layerCount) this.active = -1
  }

  private reconstructUnit(): void {
    const parent = this.parent[this.reconstructionMacro]!
    if (parent === -1) {
      if (this.reconstructionCell !== this.start)
        throw new Error("Event route does not terminate at its start")
      this.phase = "solved"
      return
    }
    const target = this.gridIndex(parent)
    const cell = this.reconstructionCell
    const targetLayer = Math.floor(target / this.plane)
    const layer = Math.floor(cell / this.plane)
    const targetColumn = target % this.columnCount
    const column = cell % this.columnCount
    const targetRow = Math.floor((target % this.plane) / this.columnCount)
    const row = Math.floor((cell % this.plane) / this.columnCount)
    if (targetLayer !== layer) this.reconstructionCell = target
    else if (targetColumn !== column) this.reconstructionCell += Math.sign(targetColumn - column)
    else if (targetRow !== row) this.reconstructionCell += Math.sign(targetRow - row) * this.columnCount
    else throw new Error("Event parent contains an empty transition")
    this.route.push(this.reconstructionCell)
    this.diagnostics.reconstructedGridEdges++
    this.reconstructionSteps++
    if (this.reconstructionSteps > this.states)
      throw new Error("Event parent path contains a cycle")
    if (this.reconstructionCell === target) this.reconstructionMacro = parent
  }

  run(steps: number, budget: number): SearchResult {
    this.inputsOrThrow()
    if (!Number.isSafeInteger(steps) || steps < 1 || !Number.isSafeInteger(budget))
      throw new Error("Event search chunk/budget is invalid")
    let work = 0
    while (work < steps) {
      if (this.phase === "solved") return { status: 1, expansions: work }
      if (this.phase === "unreachable") return { status: 2, expansions: work }
      if (this.phase === "budget" || work >= budget) {
        this.phase = "budget"
        return { status: 3, expansions: work }
      }
      if (this.phase === "compile") this.compileState()
      else if (this.phase === "coordinates") this.collectCoordinate()
      else if (this.phase === "initialize") this.initializeState()
      else if (this.phase === "search") this.searchUnit()
      else if (this.phase === "reconstruct") this.reconstructUnit()
      else throw new Error("Event search entered an invalid phase")
      work++
      this.diagnostics.workUnits++
    }
    return {
      status: this.phase === "solved" ? 1 : this.phase === "unreachable" ? 2 : 0,
      expansions: work,
    }
  }

  copyParents(target: Int32Array): void {
    if (this.phase !== "solved" || target.length !== this.states)
      throw new Error("Event parents are unavailable or use an invalid grid")
    for (let index = 0; index < this.route.length; index++) {
      target[this.route[index]!] = this.route[index + 1] ?? -1
    }
  }
}
