import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleRouteCandidatePriorityQueue } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { LazyPhysicalSingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/LazyPhysicalSingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

export function withDetailedWork(run: () => void): void {
  const previous = LazyPhysicalSingleHighDensityRouteSolver.detailedWorkDiagnostics
  LazyPhysicalSingleHighDensityRouteSolver.detailedWorkDiagnostics = true
  try { run() } finally { LazyPhysicalSingleHighDensityRouteSolver.detailedWorkDiagnostics = previous }
}

export type Options = ConstructorParameters<typeof Native>[0]
export const options = (overrides: Partial<Options> = {}): Options => ({
  connectionName: "test", rootConnectionName: "root", regionId: "region",
  obstacleRoutes: [], bounds: { minX: 0, maxX: 6, minY: 0, maxY: 6 },
  A: { x: 1, y: 1, z: 0 }, B: { x: 5, y: 5, z: 0 },
  minDistBetweenEnteringPoints: 0.2, traceThickness: 0.08, obstacleMargin: 0.05,
  nearbySegmentClearance: 0.06, viaDiameter: 0.3, layerCount: 1, availableZ: [0],
  futureConnections: [{ connectionName: "remote", points: [{ x: 100, y: 100, z: 0 }] }],
  captureSearchDebug: false, ...overrides,
})

export class UniformLazy extends LazyPhysicalSingleHighDensityRouteSolver {
  acceptedG?: number
  override setNodeCosts(node: Node): void {
    node.g = node.parent!.g + Math.hypot(node.x - node.parent!.x, node.y - node.parent!.y)
    node.h = 0
    node.f = node.g
  }
  override setSolvedPath(node: Node): void {
    this.acceptedG = node.g
    super.setSolvedPath(node)
  }
}

export function resetGrid(solver: Native, step = 1): Node {
  solver.solved = false
  solver.failed = false
  solver.solvedPath = null
  solver.cellStep = step
  solver.gridMinXIndex = Math.round(solver.bounds.minX / step) - 1
  solver.gridMinYIndex = Math.round(solver.bounds.minY / step) - 1
  solver.gridWidth = Math.round(solver.bounds.maxX / step) - solver.gridMinXIndex + 2
  solver.gridHeight = Math.round(solver.bounds.maxY / step) - solver.gridMinYIndex + 2
  solver.exploredNodes.clear()
  const root: Node = { ...solver.A, parent: null, g: 0, h: 0, f: 0 }
  solver.candidates = new SingleRouteCandidatePriorityQueue([root])
  return root
}

/** Independent explicit graph: enumerate all directed grid edges, then Dijkstra.
 * Native goal attachment is free in the search g; model that same goal region.
 */
export function explicitGraphOracle(checker: Native): number | undefined {
  const nodes: Node[] = []
  for (let x = 0; x <= 6; x++) for (let y = 0; y <= 6; y++) {
    nodes.push({ x, y, z: 0, parent: null, g: Infinity, h: 0, f: 0 })
  }
  const id = (x: number, y: number): number => x * 7 + y
  const edges = nodes.map((source) => {
    const result: Array<{ target: number; cost: number }> = []
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue
      const target: Node = { ...source, x: Math.max(0, Math.min(6, source.x + dx)),
        y: Math.max(0, Math.min(6, source.y + dy)), parent: source }
      if (checker.isNodeTooCloseToObstacle(target) || checker.isNodeTooCloseToEdge(target, false) ||
        checker.doesPathToParentIntersectObstacle(target)) continue
      result.push({ target: id(target.x, target.y), cost: Math.hypot(target.x - source.x, target.y - source.y) })
    }
    return result
  })
  const best = new Array<number>(49).fill(Infinity)
  const open = new Set<number>(nodes.map((_, i) => i))
  best[id(checker.A.x, checker.A.y)] = 0
  while (open.size) {
    let current = -1
    for (const i of open) if (current === -1 || best[i] < best[current]) current = i
    if (best[current] === Infinity) return undefined
    open.delete(current)
    const n = nodes[current]
    if (Math.hypot(n.x - checker.B.x, n.y - checker.B.y) <= Math.SQRT2 &&
      !checker.doesPathToParentIntersectObstacle({ ...n, ...checker.B, parent: n })) return best[current]
    for (const edge of edges[current]) best[edge.target] = Math.min(best[edge.target], best[current] + edge.cost)
  }
  return undefined
}

export { Native }
