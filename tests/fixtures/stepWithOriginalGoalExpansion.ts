import { distance } from "@tscircuit/math-utils"
import type { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

// Frozen _step from baseline 53df67c: the checked goal falls through to
// getNeighbors and enqueues more candidates even after marking success.
export function stepWithOriginalGoalExpansion(
  this: SingleHighDensityRouteSolver,
): void {
  let currentNode = this.candidates.dequeue()
  let currentNodeKey = currentNode ? this.getNodeKey(currentNode) : undefined

  while (
    currentNode &&
    currentNodeKey &&
    this.exploredNodes.has(currentNodeKey)
  ) {
    currentNode = this.candidates.dequeue()
    currentNodeKey = currentNode ? this.getNodeKey(currentNode) : undefined
  }

  if (!currentNode || !currentNodeKey) {
    this.failed = true
    this.error = "Ran out of candidate nodes to explore"
    return
  }
  this.exploredNodes.add(currentNodeKey)
  if (this.debugEnabled) {
    this.debug_exploredNodesOrdered.push({
      key: currentNodeKey,
      x:
        Math.round(currentNode.x / this.cellStep) * this.cellStep +
        this.initialNodeGridOffset.x,
      y:
        Math.round(currentNode.y / this.cellStep) * this.cellStep +
        this.initialNodeGridOffset.y,
      z: currentNode.z,
    })
  }

  const goalDist = distance(currentNode, this.B)

  this.progress = this.computeProgress(
    currentNode,
    goalDist,
    currentNode.z === this.B.z,
  )

  if (
    goalDist <= this.cellStep * Math.SQRT2 &&
    currentNode.z === this.B.z &&
    // Make sure the last segment doesn't intersect an obstacle
    !this.doesPathToParentIntersectObstacle({
      ...currentNode,
      parent: currentNode,
      x: this.B.x,
      y: this.B.y,
    })
  ) {
    this.solved = true
    this.setSolvedPath(currentNode)
  }

  const neighbors = this.getNeighbors(currentNode)
  for (const neighbor of neighbors) {
    this.candidates.enqueue(neighbor)
  }
}
