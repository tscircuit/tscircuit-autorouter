import { doSegmentsIntersect } from "@tscircuit/math-utils"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

type LaneGroup = { id: string; points: PortPoint[]; locked?: boolean }
type Variable = { group: number; names: [string, string]; original: number }
type Equation = { a: number; b: number; parity: number; groups: number[] }
export type SymbolicLaneResult = { nodes: NodeWithPortPoints[]; compatible: boolean; stats: Record<string, number> }
const EPS = 1e-7

/** Pairwise order domains are represented by parity classes, not permutations. */
export function realizeSymbolicLaneOrders(nodes: NodeWithPortPoints[], groups: LaneGroup[]): SymbolicLaneResult {
  const stats: Record<string, number> = { symbolicLaneGroups: groups.length, symbolicLaneVariables: 0, symbolicLaneEquations: 0, symbolicLaneTrialPredicates: 0, symbolicLaneParityConflicts: 0, symbolicLaneUnrealizedComponents: 0, symbolicLaneMovedPorts: 0, symbolicLaneCrossingsBefore: 0, symbolicLaneCrossingsAfter: 0, symbolicLaneAcceptedComponents: 0 }
  const groupByPort = new Map<string, number>()
  const pointsByGroup = groups.map((group, index) => {
    const vertical = Math.max(...group.points.map((p) => p.x)) - Math.min(...group.points.map((p) => p.x)) < EPS
    const sorted = [...group.points].sort((a, b) => vertical ? a.y - b.y : a.x - b.x)
    for (const point of sorted) {
      if (!point.portPointId) throw new Error("Symbolic lane is missing a stable port ID")
      if (groupByPort.has(point.portPointId)) throw new Error("Symbolic lane belongs to multiple interfaces")
      groupByPort.set(point.portPointId, index)
    }
    return sorted
  })
  const locked = groups.map((g, i) => Boolean(g.locked) || new Set(pointsByGroup[i]!.map((p) => p.connectionName)).size !== g.points.length)
  const pairsByNode = nodes.map((node) => {
    if (!node.portPointsInPairs) throw new Error("Symbolic lane realization requires explicit route pairs")
    const onBoundary = node.portPoints.every((p) => Math.min(Math.abs(p.x - node.center.x - node.width / 2), Math.abs(p.x - node.center.x + node.width / 2), Math.abs(p.y - node.center.y - node.height / 2), Math.abs(p.y - node.center.y + node.height / 2)) < EPS)
    if (!onBoundary || node.portPointsInPairs.some(([a, b]) => a.z !== b.z)) {
      for (const point of node.portPoints) {
        const group = point.portPointId ? groupByPort.get(point.portPointId) : undefined
        if (group !== undefined) locked[group] = true
      }
    }
    return node.portPointsInPairs
  })
  const variables: Variable[] = [{ group: -1, names: ["", ""], original: 0 }]
  const variableByKey = new Map<string, number>()
  const equations: Equation[] = []
  const groupNeighbors = groups.map(() => new Set<number>())
  const badGroups = new Set<number>()
  for (let group = 0; group < groups.length; group++) {
    const points = pointsByGroup[group]!
    for (let a = 0; a < points.length; a++) for (let b = 0; b < a; b++) {
      const names = [points[a]!.connectionName, points[b]!.connectionName].sort() as [string, string]
      if (names[0] === names[1]) continue
      const key = JSON.stringify([group, ...names])
      if (variableByKey.has(key)) continue
      const original = Number(points[b]!.connectionName !== names[0])
      const id = variables.length
      variableByKey.set(key, id); variables.push({ group, names, original })
      if (locked[group]) equations.push({ a: id, b: 0, parity: original, groups: [group] })
    }
  }
  const crosses = (a: [PortPoint, PortPoint], b: [PortPoint, PortPoint]): boolean => {
    if (a[0].z !== a[1].z || b[0].z !== b[1].z || a[0].z !== b[0].z) return false
    const firstNet = a[0].rootConnectionName ?? a[0].connectionName
    const secondNet = b[0].rootConnectionName ?? b[0].connectionName
    if (firstNet === secondNet) return false
    return doSegmentsIntersect(a[0], a[1], b[0], b[1])
  }
  for (const pairs of pairsByNode) for (let a = 0; a < pairs.length; a++) for (let b = 0; b < a; b++) {
    const first = pairs[a]!, second = pairs[b]!
    if (crosses(first, second)) stats.symbolicLaneCrossingsBefore++
    if (first[0].z !== first[1].z || second[0].z !== second[1].z || first[0].z !== second[0].z || first[0].connectionName === second[0].connectionName) continue
    if ((first[0].rootConnectionName ?? first[0].connectionName) === (second[0].rootConnectionName ?? second[0].connectionName)) continue
    const firstGroups = first.map((p) => p.portPointId ? groupByPort.get(p.portPointId) : undefined)
    const secondGroups = second.map((p) => p.portPointId ? groupByPort.get(p.portPointId) : undefined)
    const common = [...new Set(firstGroups.filter((g): g is number => g !== undefined && secondGroups.includes(g)))]
    if (common.length === 0) continue
    const names = [first[0].connectionName, second[0].connectionName].sort()
    const ids = common.map((group) => variableByKey.get(JSON.stringify([group, ...names])))
    if (ids.some((id) => id === undefined)) { for (const group of common) badGroups.add(group); continue }
    if (common.length === 2) { groupNeighbors[common[0]!]!.add(common[1]!); groupNeighbors[common[1]!]!.add(common[0]!) }
    const allowed: number[][] = []
    for (let mask = 0; mask < 1 << common.length; mask++) {
      const move = (point: PortPoint): PortPoint => {
        const group = point.portPointId ? groupByPort.get(point.portPointId) : undefined
        const index = group === undefined ? -1 : common.indexOf(group)
        if (index < 0) return point
        const ordered = pointsByGroup[group!]!
        const reversed = (mask >> index) & 1
        const low = (point.connectionName === names[0]) !== Boolean(reversed)
        const slot = ordered[low ? 0 : ordered.length - 1]!
        return { ...point, x: slot.x, y: slot.y }
      }
      stats.symbolicLaneTrialPredicates++
      if (!crosses(first.map(move) as [PortPoint, PortPoint], second.map(move) as [PortPoint, PortPoint])) allowed.push(common.map((_, index) => (mask >> index) & 1))
    }
    if (allowed.length === 0) { for (const group of common) badGroups.add(group); continue }
    if (allowed.length === 1) {
      for (let i = 0; i < common.length; i++) equations.push({ a: ids[i]!, b: 0, parity: allowed[0]![i]!, groups: common })
    } else if (common.length === 2 && allowed.length === 2) {
      const p = allowed[0]!, q = allowed[1]!
      if ((p[0]! ^ p[1]!) === (q[0]! ^ q[1]!)) equations.push({ a: ids[0]!, b: ids[1]!, parity: p[0]! ^ p[1]!, groups: common })
      else if (p[0] === q[0]) equations.push({ a: ids[0]!, b: 0, parity: p[0]!, groups: common })
      else if (p[1] === q[1]) equations.push({ a: ids[1]!, b: 0, parity: p[1]!, groups: common })
      else throw new Error("Symbolic lane binary domain is inconsistent")
    } else if (allowed.length !== 1 << common.length) {
      // Non-parity constraints lie outside this compiler's declared domain.
      for (const group of common) badGroups.add(group)
    }
  }
  const parent = variables.map((_, index) => index), parity = variables.map(() => 0)
  const find = (id: number): [number, number] => {
    let root = id, value = 0
    while (parent[root] !== root) { value ^= parity[root]!; root = parent[root]! }
    let current = id, accumulated = 0
    while (parent[current] !== current) {
      const next = parent[current]!, step = parity[current]!
      parent[current] = root; parity[current] = value ^ accumulated
      accumulated ^= step; current = next
    }
    return [root, value]
  }
  for (const equation of equations) {
    const [ar, ap] = find(equation.a), [br, bp] = find(equation.b)
    if (ar === br) {
      if ((ap ^ bp) !== equation.parity) { stats.symbolicLaneParityConflicts++; for (const group of equation.groups) badGroups.add(group) }
    } else { parent[ar] = br; parity[ar] = ap ^ bp ^ equation.parity }
  }
  stats.symbolicLaneVariables = variables.length - 1; stats.symbolicLaneEquations = equations.length
  const votes = new Map<number, [number, number]>()
  for (let id = 1; id < variables.length; id++) {
    const [root, p] = find(id), v = variables[id]!
    const counts = votes.get(root) ?? [0, 0]
    counts[v.original ^ p]++; votes.set(root, counts)
  }
  const [constantRoot, constantParity] = find(0)
  const values = variables.map((_, id) => {
    const [root, p] = find(id), counts = votes.get(root) ?? [0, 0]
    return p ^ (root === constantRoot ? constantParity : Number(counts[1] > counts[0]))
  })
  const orders: PortPoint[][] = []
  for (let group = 0; group < groups.length; group++) {
    const points = pointsByGroup[group]!, outgoing = points.map(() => [] as number[]), incoming = points.map(() => 0)
    for (let a = 0; a < points.length; a++) for (let b = 0; b < a; b++) {
      const names = [points[a]!.connectionName, points[b]!.connectionName].sort()
      const id = variableByKey.get(JSON.stringify([group, ...names]))
      if (id === undefined) { badGroups.add(group); continue }
      const before = values[id] === 0 ? names[0] : names[1]
      const source = points[a]!.connectionName === before ? a : b, target = source === a ? b : a
      outgoing[source]!.push(target); incoming[target]++
    }
    const remaining = new Set(points.map((_, i) => i)), order: PortPoint[] = []
    while (remaining.size) {
      const next = [...remaining].find((i) => incoming[i] === 0)
      if (next === undefined) { badGroups.add(group); stats.symbolicLaneUnrealizedComponents++; break }
      remaining.delete(next); order.push(points[next]!)
      for (const target of outgoing[next]!) incoming[target]--
    }
    orders.push(order)
  }
  const queue = [...badGroups]
  for (let i = 0; i < queue.length; i++) for (const neighbor of groupNeighbors[queue[i]!]!) {
    if (!badGroups.has(neighbor)) { badGroups.add(neighbor); queue.push(neighbor) }
  }
  const positions = new Map<string, { x: number; y: number }>()
  for (let group = 0; group < groups.length; group++) {
    if (badGroups.has(group)) continue
    stats.symbolicLaneAcceptedComponents++
    for (let rank = 0; rank < orders[group]!.length; rank++) {
      const identity = orders[group]![rank]!, slot = pointsByGroup[group]![rank]!
      positions.set(identity.portPointId!, { x: slot.x, y: slot.y })
      if (identity.x !== slot.x || identity.y !== slot.y) stats.symbolicLaneMovedPorts++
    }
  }
  const result = nodes.map((node) => {
    const move = (point: PortPoint): PortPoint => {
      const position = point.portPointId ? positions.get(point.portPointId) : undefined
      if (!position) return { ...point }
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error("Symbolic lane output position is invalid")
      return { ...point, ...position }
    }
    return { ...node, portPoints: node.portPoints.map(move), portPointsInPairs: node.portPointsInPairs!.map(([a, b]) => [move(a), move(b)] as [PortPoint, PortPoint]) }
  })
  for (const node of result) for (let a = 0; a < node.portPointsInPairs!.length; a++) for (let b = 0; b < a; b++) {
    if (crosses(node.portPointsInPairs![a]!, node.portPointsInPairs![b]!)) stats.symbolicLaneCrossingsAfter++
  }
  return { nodes: result, compatible: badGroups.size === 0 && stats.symbolicLaneCrossingsAfter === 0, stats }
}
