import type { DistinctOwnerBlockerHop } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"

export type OwnerCutCondensation = {
  start: number
  goals: ReadonlySet<number>
  adjacency: Array<Array<{ to: number; owners: readonly number[] }>>
  stateCount: number
  rawConditionalArcCount: number
}

export type OwnerCutCondensationWork =
  | "condensationStates" | "condensationHopVisits"
  | "condensationOwnerVisits" | "condensationArcVisits"

type Node<S, O, D> = {
  state: S
  index: number
  low: number
  onStack: boolean
  component: number
  hops: Array<DistinctOwnerBlockerHop<S, O, D>>
}

/**
 * Iterative Tarjan on ZERO-owner directed edges, while discovering every state
 * reachable when owners are released. Goal states remain absorbing as native.
 * Nonzero edges never merge components, even if they point back to ancestors.
 * Cross-component zero edges are retained; undirected union-find is unsound.
 */
export function buildOwnerCutCondensation<S, K, O, D>(input: {
  start: S
  getStateKey: (state: S) => K
  isGoal: (state: S) => boolean
  getHops: (state: S) => Array<DistinctOwnerBlockerHop<S, O, D>>
  getOwners: (hop: DistinctOwnerBlockerHop<S, O, D>) => readonly number[]
  charge: (field: OwnerCutCondensationWork) => boolean
}): OwnerCutCondensation | undefined {
  const nodes: Array<Node<S, O, D>> = []
  const nodeByKey = new Map<K, number>()
  const stack: number[] = []
  const frames: Array<{ node: number; nextHop: number }> = []
  const rawArcs: Array<{ from: number; to: number; owners: readonly number[] }> = []
  const goalNodes: number[] = []
  let nextIndex = 0
  let components = 0
  let rawConditionalArcCount = 0
  const ensureNode = (state: S): number => {
    const key = input.getStateKey(state)
    const known = nodeByKey.get(key)
    if (known !== undefined) return known
    const id = nodes.length
    nodeByKey.set(key, id)
    nodes.push({ state, index: -1, low: -1, onStack: false, component: -1, hops: [] })
    return id
  }
  const begin = (id: number): boolean => {
    if (!input.charge("condensationStates")) return false
    const node = nodes[id]!
    node.index = node.low = nextIndex++
    node.onStack = true
    if (input.isGoal(node.state)) goalNodes.push(id)
    else node.hops = input.getHops(node.state)
    stack.push(id)
    frames.push({ node: id, nextHop: 0 })
    return true
  }
  const startNode = ensureNode(input.start)
  // Conditional edges discover more roots; zero edges descend immediately.
  for (let root = 0; root < nodes.length; root++) {
    if (nodes[root]!.index >= 0) continue
    if (!begin(root)) return undefined
    while (frames.length > 0) {
      const frame = frames.at(-1)!
      const node = nodes[frame.node]!
      if (frame.nextHop < node.hops.length) {
        if (!input.charge("condensationHopVisits")) return undefined
        const hop = node.hops[frame.nextHop++]!
        if (!Number.isFinite(hop.distance) || hop.distance < 0) throw new Error("Owner-cut hops require finite distances >= 0")
        const owners = input.getOwners(hop)
        for (const _owner of owners) if (!input.charge("condensationOwnerVisits")) return undefined
        const next = ensureNode(hop.state)
        const target = nodes[next]!
        if (owners.length > 0) {
          rawArcs.push({ from: frame.node, to: next, owners })
          rawConditionalArcCount++
        } else if (target.index < 0) {
          if (!begin(next)) return undefined
        } else if (target.onStack) {
          node.low = Math.min(node.low, target.index)
        } else {
          rawArcs.push({ from: frame.node, to: next, owners })
        }
        continue
      }
      frames.pop()
      if (node.low === node.index) {
        while (true) {
          const popped = stack.pop()
          if (popped === undefined) throw new Error("Owner-cut Tarjan stack is empty")
          nodes[popped]!.onStack = false
          nodes[popped]!.component = components
          if (popped === frame.node) break
        }
        components++
      }
      const parent = frames.at(-1)
      if (parent) {
        nodes[parent.node]!.low = Math.min(nodes[parent.node]!.low, node.low)
        if (node.component >= 0) rawArcs.push({ from: parent.node, to: frame.node, owners: [] })
      }
    }
  }
  const adjacency: OwnerCutCondensation["adjacency"] = Array.from({ length: components }, () => [])
  const seen = new Set<string>()
  for (const arc of rawArcs) {
    if (!input.charge("condensationArcVisits")) return undefined
    const from = nodes[arc.from]!.component
    const to = nodes[arc.to]!.component
    if (from === to) continue
    const owners = [...arc.owners].sort((a, b): number => a - b)
    const key = `${from}:${to}:${owners.join(",")}`
    if (seen.has(key)) continue
    seen.add(key)
    adjacency[from]!.push({ to, owners })
  }
  return { start: nodes[startNode]!.component, goals: new Set(goalNodes.map((node): number => nodes[node]!.component)), adjacency, stateCount: nodes.length, rawConditionalArcCount }
}
