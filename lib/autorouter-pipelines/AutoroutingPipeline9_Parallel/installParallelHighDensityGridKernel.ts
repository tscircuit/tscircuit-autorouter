import type { Node } from "../../data-structures/SingleRouteCandidatePriorityQueue"
import type { IntraNodeRouteSolver } from "../../solvers/HighDensitySolver/IntraNodeSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "../../solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { PackedHighDensityCandidateHeap } from "./PackedHighDensityCandidateHeap"

const installedRoutes = new WeakSet<SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost>()
const installedNodes = new WeakSet<IntraNodeRouteSolver>()

/** Install before the first search step; constructor geometry remains native. */
export function installParallelHighDensityRouteGridKernel(
  solver: SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
): void {
  if (installedRoutes.has(solver)) return
  if (solver.iterations !== 0) {
    throw new Error("Parallel HD grid kernel must be installed before search")
  }
  const initial = solver.candidates.dequeue()
  if (!initial || solver.candidates.dequeue() !== null) {
    throw new Error("Parallel HD grid kernel expected one native initial candidate")
  }
  solver.candidates = new PackedHighDensityCandidateHeap([initial])
  const neighbors: Node[] = []
  const candidate: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  solver.getNeighbors = (node: Node): Node[] => {
    neighbors.length = 0
    let sharedPlanarObstacleQuery: ReturnType<typeof solver.getPlanarNeighborObstacleQuery>
    let queriedPlanarNeighbors = false
    const { maxX, minX, maxY, minY } = solver.bounds

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        if (x === 0 && y === 0) continue
        candidate.x = Math.max(minX, Math.min(node.x + x * solver.cellStep, maxX))
        candidate.y = Math.max(minY, Math.min(node.y + y * solver.cellStep, maxY))
        candidate.z = node.z
        candidate.g = node.g
        candidate.h = node.h
        candidate.f = node.f
        candidate.parent = node
        const neighborKey = solver.getNodeKey(candidate)
        if (solver.exploredNodes.has(neighborKey)) continue
        if (!queriedPlanarNeighbors) {
          sharedPlanarObstacleQuery = solver.getPlanarNeighborObstacleQuery(node)
          queriedPlanarNeighbors = true
        }
        const planarObstacleQuery = solver.getPlanarObstacleQuery(
          candidate, sharedPlanarObstacleQuery, neighborKey,
        )
        if (solver.isNodeTooCloseToObstacle(candidate, undefined, false, planarObstacleQuery)) {
          if (solver.debugEnabled) solver.debug_nodesTooCloseToObstacle.add(neighborKey)
          solver.exploredNodes.add(neighborKey)
          continue
        }
        if (solver.isNodeTooCloseToEdge(candidate, false)) {
          solver.exploredNodes.add(neighborKey)
          continue
        }
        if (solver.doesPathToParentIntersectObstacle(candidate, planarObstacleQuery)) {
          if (solver.debugEnabled) solver.debug_nodePathToParentIntersectsObstacle.add(neighborKey)
          solver.exploredNodes.add(neighborKey)
          continue
        }
        solver.setNodeCosts(candidate)
        neighbors.push({
          x: candidate.x, y: candidate.y, z: candidate.z,
          g: candidate.g, h: candidate.h, f: candidate.f, parent: candidate.parent,
        })
      }
    }
    for (const newZ of solver.availableZ) {
      if (newZ === node.z) continue
      candidate.x = node.x
      candidate.y = node.y
      candidate.z = newZ
      candidate.g = node.g
      candidate.h = node.h
      candidate.f = node.f
      candidate.parent = node
      if (
        !solver.exploredNodes.has(solver.getNodeKey(candidate)) &&
        !solver.isNodeTooCloseToObstacle(candidate, solver.viaDiameter / 2 + solver.obstacleMargin / 2, true) &&
        !solver.isNodeTooCloseToEdge(candidate, true)
      ) {
        solver.setNodeCosts(candidate)
        neighbors.push({
          x: candidate.x, y: candidate.y, z: candidate.z,
          g: candidate.g, h: candidate.h, f: candidate.f, parent: candidate.parent,
        })
      }
    }
    return neighbors
  }
  installedRoutes.add(solver)
}

/** Keep the native cached node, retries, and factory; adapt each new grid child. */
export function installParallelIntraNodeGridKernel<T extends IntraNodeRouteSolver>(solver: T): T {
  if (installedNodes.has(solver)) return solver
  const installChild = (): void => {
    if (solver.activeSubSolver instanceof SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost) {
      installParallelHighDensityRouteGridKernel(solver.activeSubSolver)
    }
  }
  installChild()
  const originalStep = solver._step.bind(solver)
  solver._step = (): void => {
    originalStep()
    installChild()
  }
  installedNodes.add(solver)
  return solver
}
