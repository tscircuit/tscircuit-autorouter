import { EventTileSearchKernel, type EventTileSearchInputs } from "lib/solvers/HighDensitySolver/EventTileSearchKernel"

export const emptyEventInput = (cols: number, rows: number, layers: number): EventTileSearchInputs => {
  const plane = cols * rows
  return {
    traceCost: new Uint16Array(plane * layers),
    fixed: new Uint8Array(plane * layers),
    history: new Float64Array(plane * layers),
    heuristicCost: new Float64Array(plane * layers),
    viaCost: new Uint16Array(plane),
    viaHistory: new Float64Array(plane),
    fixedVia: new Uint8Array(plane),
    viaAllowed: new Uint8Array(plane).fill(1),
  }
}

export const denseEventOracle = (
  input: EventTileSearchInputs,
  cols: number,
  rows: number,
  layers: number,
  start: number,
  goal: number,
  present = 0.5,
  pitchX = 1,
  pitchY = 1,
): number => {
  const plane = cols * rows
  const states = plane * layers
  const distances = new Float64Array(states).fill(Infinity)
  const settled = new Uint8Array(states)
  distances[start] = 0
  for (let iteration = 0; iteration < states; iteration++) {
    let current = -1
    for (let state = 0; state < states; state++) {
      if (!settled[state] && (current === -1 || distances[state]! < distances[current]!)) current = state
    }
    if (current === -1 || distances[current] === Infinity) return Infinity
    if (current === goal) return distances[current]!
    settled[current] = 1
    const layer = Math.floor(current / plane)
    const xy = current % plane
    const col = xy % cols
    const row = Math.floor(xy / cols)
    const edges: Array<[number, number]> = []
    const horizontal = pitchX * (layer % 2 ? 1.05 : 1)
    const vertical = pitchY * (layer % 2 ? 1 : 1.05)
    if (col > 0) edges.push([current - 1, horizontal])
    if (col + 1 < cols) edges.push([current + 1, horizontal])
    if (row > 0) edges.push([current - cols, vertical])
    if (row + 1 < rows) edges.push([current + cols, vertical])
    for (const [next, base] of edges) {
      if (input.fixed[next] && next !== goal) continue
      const cost = base + present * input.traceCost[next]! + input.history[next]!
      distances[next] = Math.min(distances[next]!, distances[current]! + cost)
    }
    if (!input.viaAllowed[xy] || input.fixedVia[xy]) continue
    for (let nextLayer = 0; nextLayer < layers; nextLayer++) {
      if (nextLayer === layer) continue
      const next = nextLayer * plane + xy
      if (input.fixed[next] && next !== goal) continue
      const cost = 0.8 + present * input.viaCost[xy]! + input.viaHistory[xy]!
      distances[next] = Math.min(distances[next]!, distances[current]! + cost)
    }
  }
  return distances[goal]!
}

export const runEventQuery = (
  input: EventTileSearchInputs,
  cols: number,
  rows: number,
  layers: number,
  start: number,
  goal: number,
  present = 0.5,
  pitchX = 1,
  pitchY = 1,
): { cost: number; parents: Int32Array; kernel: EventTileSearchKernel } => {
  const kernel = new EventTileSearchKernel(cols, rows, layers, pitchX, pitchY)
  kernel.begin(input, start, goal, present)
  let status = 0
  let work = 0
  while (status === 0) {
    const result = kernel.run(37, 1_000_000 - work)
    status = result.status
    work += result.expansions
    if (status === 3) throw new Error("Tiny event oracle exhausted its work allowance")
  }
  const parents = new Int32Array(cols * rows * layers).fill(-1)
  if (status === 2) return { cost: Infinity, parents, kernel }
  kernel.copyParents(parents)
  let cost = 0
  const plane = cols * rows
  let steps = 0
  for (let current = goal; parents[current] !== -1; current = parents[current]!) {
    const previous = parents[current]!
    const layer = Math.floor(current / plane)
    const previousLayer = Math.floor(previous / plane)
    if (input.fixed[current] && current !== goal) throw new Error("Event parent enters fixed copper")
    if (layer !== previousLayer) {
      const xy = current % plane
      if (previous % plane !== xy || !input.viaAllowed[xy] || input.fixedVia[xy]) throw new Error("Invalid reconstructed via")
      cost += 0.8 + present * input.viaCost[xy]! + input.viaHistory[xy]!
    } else {
      const dx = Math.abs(current % cols - previous % cols)
      const dy = Math.abs(Math.floor(current % plane / cols) - Math.floor(previous % plane / cols))
      if (dx + dy !== 1) throw new Error("Event parent skipped an original grid edge")
      const base = dx ? pitchX * (layer % 2 ? 1.05 : 1) : pitchY * (layer % 2 ? 1 : 1.05)
      cost += base + present * input.traceCost[current]! + input.history[current]!
    }
    if (++steps > parents.length) throw new Error("Reconstructed event parent cycle")
  }
  return { cost, parents, kernel }
}
