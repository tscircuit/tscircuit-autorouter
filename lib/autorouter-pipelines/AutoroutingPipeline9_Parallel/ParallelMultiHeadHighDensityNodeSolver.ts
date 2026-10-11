import { BaseSolver } from "../../solvers/BaseSolver"
import { HighDensitySolver } from "../../solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { PortfolioSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "../../types/high-density-types"
import { Pipeline9HighDensitySolver, createPipeline9RegularNodeSolver, type Pipeline9HighDensitySolverParams } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { ParallelPortfolioSingleIntraNodeSolver } from "./ParallelPortfolioSingleIntraNodeSolver"
import type { MultiHeadHistoryDispatcher } from "./parallelMultiHeadHistoryTypes"

class ParallelGrowShrinkIntraNodeSolver extends GrowShrinkHighDensityIntraNodeSolver {
  constructor(
    params: ConstructorParameters<typeof GrowShrinkHighDensityIntraNodeSolver>[0],
    private readonly dispatcher: MultiHeadHistoryDispatcher,
  ) {
    super(params)
  }

  protected override createPortfolioSolver(params: ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0]): PortfolioSingleIntraNodeSolver {
    const solver = new ParallelPortfolioSingleIntraNodeSolver(
      params,
      this.dispatcher,
    )
    return solver
  }

  prepareForNextStep(): void {
    if (this.solved || this.failed) return
    if (!this.activeSubSolver) {
      // Construct the same child before stepping ancestors, so awaiting a
      // history does not introduce additional routing or supervisor iterations.
      this.createActiveSubSolver()
    }
  }
}

function createParallelHighDensityClass(dispatcher: MultiHeadHistoryDispatcher): typeof HighDensitySolver {
  return class extends HighDensitySolver {
    protected override createIntraNodeSolver(params: ConstructorParameters<typeof GrowShrinkHighDensityIntraNodeSolver>[0]): GrowShrinkHighDensityIntraNodeSolver | PortfolioSingleIntraNodeSolver {
      return this.useGrowShrinkHighDensityIntraNodeSolver
        ? new ParallelGrowShrinkIntraNodeSolver(params, dispatcher)
        : new ParallelPortfolioSingleIntraNodeSolver(params, dispatcher)
    }
  }
}

/** Whole-node policy is unchanged; only independent noncached candidates move. */
export class ParallelMultiHeadHighDensityNodeSolver extends Pipeline9HighDensitySolver {
  private readonly dispatcher: MultiHeadHistoryDispatcher

  constructor(
    params: Pipeline9HighDensitySolverParams,
    dispatcher: MultiHeadHistoryDispatcher,
  ) {
    super(params)
    this.dispatcher = dispatcher
  }

  protected override createRegularNodeSolver(node: NodeWithPortPoints): HighDensitySolver {
    return createPipeline9RegularNodeSolver({
      nodeWithPortPoints: node, colorMap: this.colorMap, connMap: this.connMap,
      viaDiameter: this.viaDiameter, traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin, effort: this.effort,
      nodePfById: this.nodePfById, obstacles: this.obstacles,
      boardGeometry: this.boardGeometry, layerCount: this.layerCount,
    }, createParallelHighDensityClass(this.dispatcher))
  }

  async solveAsync(): Promise<void> {
    const started = Date.now()
    while (!this.solved && !this.failed) {
      let cursor: BaseSolver | null | undefined = this
      while (cursor) {
        if (cursor instanceof ParallelGrowShrinkIntraNodeSolver) cursor.prepareForNextStep()
        if (cursor instanceof ParallelPortfolioSingleIntraNodeSolver) await cursor.prepareForNextStep()
        cursor = cursor.activeSubSolver
      }
      this.step()
    }
    this.timeToSolve = Date.now() - started
  }
}
