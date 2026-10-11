import type { SearchInputs } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/a13-search-wasm/SearchInputs"

/** Close translation of kernel.c: same topology flags, cost arithmetic,
 * versioned heap entries, tie comparisons, and queue-pop chunk boundaries.
 * Heap fields use separate typed arrays (16 bytes total per entry).
 * Scalars live in the constructor closure, like the C module's private globals.
 */
export class JavascriptSearchKernel {
  readonly begin: (
    inputs: SearchInputs,
    start: number,
    goal: number,
    presentCost: number,
  ) => void
  readonly run: (
    steps: number,
    budget: number,
  ) => { status: number; expansions: number }
  readonly copyParents: (target: Int32Array) => void

  constructor(
    cols: number,
    rows: number,
    layers: number,
    pitchX: number,
    pitchY: number,
  ) {
    const plane = cols * rows,
      states = plane * layers
    const distance = new Float64Array(states),
      parent = new Int32Array(states)
    const versions = new Uint32Array(states)
    const stateXY = new Int32Array(states),
      stateFlags = new Uint8Array(states)
    let goal = 0,
      presentCost = 0,
      heapSize = 0,
      heapCapacity = 1024
    let heapF = new Float64Array(heapCapacity),
      heapIndex = new Int32Array(heapCapacity),
      heapVersion = new Uint32Array(heapCapacity)
    let traceCost: Uint16Array,
      viaCost: Uint16Array,
      fixed: Uint8Array,
      fixedVia: Uint8Array,
      history: Float64Array,
      viaHistory: Float64Array,
      heuristic: Float64Array,
      viaAllowed: Uint8Array
    for (let i = 0; i < states; i++) {
      const xy = i % plane,
        col = xy % cols,
        row = Math.floor(xy / cols),
        z = Math.floor(i / plane)
      stateXY[i] = xy
      stateFlags[i] =
        Number(col > 0) |
        (Number(col + 1 < cols) << 1) |
        (Number(row > 0) << 2) |
        (Number(row + 1 < rows) << 3) |
        ((z % 2) << 4)
    }
    function push(index: number, f: number) {
      let i = heapSize++
      while (i > 0) {
        const p = (i - 1) >> 1
        if (heapF[p]! <= f) break
        heapF[i] = heapF[p]!
        heapIndex[i] = heapIndex[p]!
        heapVersion[i] = heapVersion[p]!
        i = p
      }
      heapF[i] = f
      heapIndex[i] = index
      versions[index] = (versions[index]! + 1) >>> 0
      heapVersion[i] = versions[index]!
    }
    // Scalar results avoid allocating a JS object for each C struct return.
    let poppedIndex = 0,
      poppedVersion = 0
    function pop() {
      poppedIndex = heapIndex[0]!
      poppedVersion = heapVersion[0]!
      const last = --heapSize
      if (!last) return
      const index = heapIndex[last]!,
        version = heapVersion[last]!,
        f = heapF[last]!
      let i = 0
      while (i * 2 + 1 < heapSize) {
        let child = i * 2 + 1
        if (child + 1 < heapSize && heapF[child + 1]! < heapF[child]!) child++
        if (f <= heapF[child]!) break
        heapF[i] = heapF[child]!
        heapIndex[i] = heapIndex[child]!
        heapVersion[i] = heapVersion[child]!
        i = child
      }
      heapF[i] = f
      heapIndex[i] = index
      heapVersion[i] = version
    }
    function visit(
      next: number,
      base: number,
      via: boolean,
      xy: number,
      currentIndex: number,
      currentG: number,
    ) {
      const baseG = currentG + base
      if (baseG >= distance[next]!) return
      if (fixed[next] && next !== goal) return
      if (via && fixedVia[xy]) return
      const congestion = via ? viaCost[xy]! : traceCost[next]!
      const past = via ? viaHistory[xy]! : history[next]!
      const g = baseG + presentCost * congestion + past
      if (g >= distance[next]!) return
      distance[next] = g
      parent[next] = currentIndex
      push(next, g + heuristic[next]!)
    }
    this.begin = (inputs, start, end, present) => {
      // The router does not mutate these fields during an active search, so no
      // linear-memory copy is needed in JavaScript.
      ;({
        traceCost,
        viaCost,
        fixed,
        fixedVia,
        history,
        viaHistory,
        viaAllowed,
      } = inputs)
      heuristic = inputs.heuristicCost
      goal = end
      presentCost = present
      heapSize = 0
      distance.fill(Infinity)
      parent.fill(-1)
      versions.fill(0)
      distance[start] = 0
      push(start, heuristic[start]!)
    }
    this.run = (steps, budget) => {
      let expansions = 0,
        pops = 0
      while (pops < steps) {
        if (expansions >= budget) return { status: 3, expansions }
        if (!heapSize) return { status: 2, expansions }
        // Same reserve-before-pop boundary; growing does not consume a step.
        if (heapSize + 4 + layers > heapCapacity) {
          heapCapacity *= 2
          const f = new Float64Array(heapCapacity),
            indices = new Int32Array(heapCapacity),
            stamps = new Uint32Array(heapCapacity)
          f.set(heapF)
          indices.set(heapIndex)
          stamps.set(heapVersion)
          heapF = f
          heapIndex = indices
          heapVersion = stamps
          continue
        }
        pop()
        pops++
        const currentIndex = poppedIndex
        if (poppedVersion !== versions[currentIndex]) continue
        const currentG = distance[currentIndex]!
        expansions++
        if (currentIndex === goal) return { status: 1, expansions }
        const xy = stateXY[currentIndex]!,
          flags = stateFlags[currentIndex]!
        const horizontal = pitchX * (flags & 16 ? 1.05 : 1)
        const vertical = pitchY * (flags & 16 ? 1 : 1.05)
        if (flags & 1)
          visit(currentIndex - 1, horizontal, false, 0, currentIndex, currentG)
        if (flags & 2)
          visit(currentIndex + 1, horizontal, false, 0, currentIndex, currentG)
        if (flags & 4)
          visit(currentIndex - cols, vertical, false, 0, currentIndex, currentG)
        if (flags & 8)
          visit(currentIndex + cols, vertical, false, 0, currentIndex, currentG)
        if (viaAllowed[xy])
          for (let layer = 0; layer < layers; layer++) {
            const next = layer * plane + xy
            if (next !== currentIndex)
              visit(next, 0.8, true, xy, currentIndex, currentG)
          }
      }
      return { status: 0, expansions }
    }
    this.copyParents = (target) => target.set(parent)
    ;(this as any).proofState = () => ({ distance, parent, versions, stateXY, stateFlags, goal, presentCost, heapSize, heapCapacity, heapF, heapIndex, heapVersion })
  }
}
