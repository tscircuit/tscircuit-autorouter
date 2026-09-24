import assert from "node:assert/strict"
import { buildMinimumSpanningTree } from "../../lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { NetToPointPairsSolver } from "../../lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { ConnectionPoint, SimpleRouteJson } from "../../lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "../../lib/utils/get-initially-connected-map-from-simple-route-json"

type AuditResult = {
  case: string
  terminals: number
  edges: number
  reachableTerminals: number
  solved: boolean
  failed: boolean
}

// Reachability uses terminal IDs, independently of the production index-based tree.
function audit(name: string, points: ConnectionPoint[]): AuditResult {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 1100, minY: -1, maxY: 1100 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [{ name, pointsToConnect: points }],
  }
  const before = structuredClone(srj)
  const solver = new NetToPointPairsSolver(
    srj, {}, getInitiallyConnectedMapFromSimpleRouteJson(srj),
  )
  solver.solve()
  assert.deepEqual(srj, before, "solver mutated caller input")
  const pairs = solver.newConnections.map((c) => c.pointsToConnect)
  const reached = new Set([points[0].pointId])
  let previousSize = -1
  while (previousSize !== reached.size) {
    previousSize = reached.size
    for (const [a, b] of pairs) {
      if (reached.has(a.pointId)) reached.add(b.pointId)
      if (reached.has(b.pointId)) reached.add(a.pointId)
    }
  }
  return {
    case: name, terminals: points.length, edges: pairs.length,
    reachableTerminals: reached.size, solved: solver.solved, failed: solver.failed,
  }
}

// Independent dense Prim oracle: identities are indices, candidates are complete.
function densePrimWeight(points: ConnectionPoint[]): number {
  const used = new Set<number>()
  const distance = points.map(() => Infinity)
  distance[0] = 0
  let total = 0
  for (let iteration = 0; iteration < points.length; iteration++) {
    let next = -1
    for (let i = 0; i < points.length; i++) {
      if (!used.has(i) && (next === -1 || distance[i] < distance[next])) next = i
    }
    assert(next >= 0 && Number.isFinite(distance[next]))
    used.add(next)
    total += distance[next]
    for (let i = 0; i < points.length; i++) {
      const weight = Math.hypot(points[next].x - points[i].x, points[next].y - points[i].y)
      if (!used.has(i) && weight < distance[i]) distance[i] = weight
    }
  }
  return total
}

const coincident: ConnectionPoint[] = [
  { x: 0, y: 0, pointId: "a", layer: "top" },
  { x: 0, y: 0, pointId: "b", layer: "bottom" },
  { x: 1, y: 0, pointId: "c", layer: "top" },
]
const clusters: ConnectionPoint[] = Array.from({ length: 22 }, (_, i) => ({
  x: i < 11 ? i : 1000 + i, y: 0, pointId: `p${i}`, layer: "top",
}))
const identityResult = audit("coincident-distinct-terminals", coincident)
const clusterResult = audit("two-separated-clusters", clusters)
assert.equal(identityResult.edges, 2)
assert.equal(identityResult.reachableTerminals, 3)
assert.equal(clusterResult.edges, 21)
assert.equal(clusterResult.reachableTerminals, 22)
for (const result of [identityResult, clusterResult]) {
  assert.equal(result.solved, true)
  assert.equal(result.failed, false)
}
const clusterEdges = buildMinimumSpanningTree(clusters)
assert(clusterEdges.some((e) => (e.from.x < 11) !== (e.to.x < 11)))
console.log(JSON.stringify([identityResult, clusterResult], null, 2))

// The original deterministic counterexample must now have optimal weight.
let seed = 1
const points: ConnectionPoint[] = []
for (let i = 0; i < 64; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  const x = seed % 1000
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  const y = seed % 1000
  points.push({ x, y, pointId: `p${i}`, layer: "top" })
}
const edges = buildMinimumSpanningTree(points)
const actual = edges.reduce((sum, e) => sum + e.weight, 0)
const expected = densePrimWeight(points)
assert.equal(edges.length, points.length - 1)
assert(Math.abs(actual - expected) < 1e-8)
assert.equal(audit("connected-minimal", points).reachableTerminals, points.length)
console.log(JSON.stringify({ seed: 1, terminals: points.length, actual, expected }, null, 2))
console.log("All original counterexamples now satisfy connectivity and weight checks.")
