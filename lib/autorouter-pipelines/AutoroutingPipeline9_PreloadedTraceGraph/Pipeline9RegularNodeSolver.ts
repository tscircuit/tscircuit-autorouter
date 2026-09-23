import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { Pipeline9NodeSimplificationSolver } from "./Pipeline9NodeSimplificationSolver"

/** Shared by local Pipeline9 and the networked single-node worker. */
export class Pipeline9RegularNodeSolver extends HighDensitySolver {
  private readonly node: NodeWithPortPoints
  nodeSimplificationSolver: Pipeline9NodeSimplificationSolver | null = null
  private simplificationTimeMs = 0

  constructor(params: ConstructorParameters<typeof HighDensitySolver>[0]) {
    super(params)
    if (params.nodePortPoints.length !== 1 || !params.connMap) {
      throw new Error("Pipeline9RegularNodeSolver requires one node and a connectivity map")
    }
    this.node = params.nodePortPoints[0]!
  }

  override _step(): void {
    if (!this.nodeSimplificationSolver) {
      super._step()
      if (!this.solved) return
      this.solved = false
      const start = performance.now()
      this.nodeSimplificationSolver = new Pipeline9NodeSimplificationSolver({
        node: this.node,
        routes: this.routes,
        obstacles: this.obstacles,
        connMap: this.connMap!,
        layerCount: this.layerCount,
        clearance: this.obstacleMargin,
        boardGeometry: this.boardGeometry,
      })
      this.simplificationTimeMs += performance.now() - start
      return
    }
    const start = performance.now()
    this.nodeSimplificationSolver.step()
    this.simplificationTimeMs += performance.now() - start
    if (this.nodeSimplificationSolver.failed) {
      throw new Error(this.nodeSimplificationSolver.error ?? "Node simplification failed")
    }
    if (!this.nodeSimplificationSolver.solved) return
    this.routes = this.nodeSimplificationSolver.getOutput()
    this.stats.nodeSimplification = {
      ...this.nodeSimplificationSolver.stats,
      timeMs: this.simplificationTimeMs,
    }
    this.solved = true
  }
}
