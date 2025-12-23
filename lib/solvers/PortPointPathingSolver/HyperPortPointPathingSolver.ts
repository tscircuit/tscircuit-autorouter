import type { GraphicsObject } from "graphics-debug"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
  type HyperParameterDef,
} from "../HyperParameterSupervisorSolver"
import {
  PortPointPathingHyperParameters,
  PortPointPathingSolver,
  type InputNodeWithPortPoints,
} from "./PortPointPathingSolver"
import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "../../types"
import type { NodeWithPortPoints } from "../../types/high-density-types"

export interface HyperPortPointPathingSolverParams {
  simpleRouteJson: SimpleRouteJson
  capacityMeshNodes: CapacityMeshNode[]
  inputNodes: InputNodeWithPortPoints[]
  colorMap?: Record<string, string>
  nodeMemoryPfMap?: Map<CapacityMeshNodeId, number>
  numShuffleSeeds?: number
  minAllowedBoardScore?: number
  hyperParameters?: Partial<PortPointPathingHyperParameters>
}

export class HyperPortPointPathingSolver extends HyperParameterSupervisorSolver<PortPointPathingSolver> {
  private params: HyperPortPointPathingSolverParams

  constructor(params: HyperPortPointPathingSolverParams) {
    super()
    this.params = params
    this.MAX_ITERATIONS = 100e6
    this.GREEDY_MULTIPLIER = 1.2
    // Run each solver for enough steps to get meaningful score differentiation
    // This allows early scores to diverge before switching, enabling better decisions
    this.MIN_SUBSTEPS = 50
  }

  getHyperParameterDefs(): Array<HyperParameterDef> {
    const numSeeds = this.params.numShuffleSeeds ?? 50
    const shuffleSeeds = Array.from({ length: numSeeds }, (_, i) => ({
      SHUFFLE_SEED: i + (this.params.hyperParameters?.SHUFFLE_SEED ?? 0) * 1700,
    }))

    return [
      {
        name: "SHUFFLE_SEED",
        possibleValues: shuffleSeeds,
      },
      // {
      //   name: "MORE_GREEDY",
      //   possibleValues: [
      //     {
      //       GREEDY_MULTIPLIER: 5,
      //     },
      //     {
      //       GREEDY_MULTIPLIER: 20,
      //     },
      //   ],
      // },
      // {
      //   name: "SHUFFLE_SEED_SMALL",
      //   possibleValues: shuffleSeeds.slice(0, Math.min(10, numSeeds / 5)),
      // },
      // {
      //   name: "RANDOM_WALK_DISTANCE",
      //   possibleValues: [
      //     {
      //       RANDOM_WALK_DISTANCE: 0,
      //     },
      //     // {
      //     //   RANDOM_WALK_DISTANCE: 5,
      //     // },
      //     {
      //       RANDOM_WALK_DISTANCE: 20,
      //     },
      //   ],
      // },
    ]
  }

  override getCombinationDefs(): Array<string[]> {
    return [["SHUFFLE_SEED"]]
    // return [["GREEDY_MULTIPLIER", "SHUFFLE_SEED_SMALL"], ["SHUFFLE_SEED"]]
    // return [["SHUFFLE_SEED", "RANDOM_WALK_DISTANCE"]]
  }

  generateSolver(hyperParameters: any): PortPointPathingSolver {
    return new PortPointPathingSolver({
      simpleRouteJson: this.params.simpleRouteJson,
      capacityMeshNodes: this.params.capacityMeshNodes,
      inputNodes: this.params.inputNodes,
      colorMap: this.params.colorMap,
      nodeMemoryPfMap: this.params.nodeMemoryPfMap,
      hyperParameters: {
        ...this.params.hyperParameters,
        ...hyperParameters,
        MIN_ALLOWED_BOARD_SCORE:
          hyperParameters.MIN_ALLOWED_BOARD_SCORE ??
          this.params.minAllowedBoardScore,
      },
    })
  }

  /**
   * G measures the "cost" of this solver based on current score.
   * We use the raw board score (more negative = worse quality = higher cost).
   *
   * The key insight is that early scores (at ~25% progress) are predictive
   * of final quality. Solvers with better early scores tend to finish better.
   */
  computeG(solver: PortPointPathingSolver): number {
    const boardScore = solver.computeBoardScore()
    return -boardScore
  }

  /**
   * H estimates remaining "cost" based on current trajectory.
   *
   * Key insight from analysis: bad solvers have similar early scores but
   * explode later (e.g., seed 760: -0.23 @ 25% → -15.05 final).
   * Good solvers maintain low scores throughout (e.g., seed 829: -0.06 @ 25% → -2.42 final).
   *
   * We estimate remaining cost by extrapolating current score/connection rate.
   */
  computeH(solver: PortPointPathingSolver): number {
    const progress = solver.progress || 0

    // If very early, don't penalize yet - not enough signal
    if (progress < 0.1) return 0

    const boardScore = solver.computeBoardScore()
    const remainingProgress = 1 - progress

    // Estimate: if we're at X% progress with score Y, we might end up at Y / progress
    // This extrapolates current score rate to final score
    // A solver with score -0.5 at 50% might end at -1.0
    // A solver with score -2.0 at 50% might end at -4.0
    const scorePerProgress = boardScore / progress
    const estimatedRemainingCost = -scorePerProgress * remainingProgress

    return estimatedRemainingCost
  }

  /**
   * Get the nodes with port points from the winning solver
   */
  getNodesWithPortPoints(): NodeWithPortPoints[] {
    if (this.winningSolver) {
      return this.winningSolver.getNodesWithPortPoints()
    }
    // If not solved yet, get from the best current solver
    const best = this.getSupervisedSolverWithBestFitness()
    if (best) {
      return best.solver.getNodesWithPortPoints()
    }
    return []
  }

  /**
   * Get connection results from the winning solver
   */
  get connectionsWithResults() {
    if (this.winningSolver) {
      return this.winningSolver.connectionsWithResults
    }
    const best = this.getSupervisedSolverWithBestFitness()
    if (best) {
      return best.solver.connectionsWithResults
    }
    return []
  }

  /**
   * Get input nodes from the winning solver
   */
  get inputNodes(): InputNodeWithPortPoints[] {
    if (this.winningSolver) {
      return this.winningSolver.inputNodes
    }
    const best = this.getSupervisedSolverWithBestFitness()
    if (best) {
      return best.solver.inputNodes
    }
    return this.params.inputNodes
  }

  /**
   * Get node map from the winning solver
   */
  get nodeMap(): Map<CapacityMeshNodeId, InputNodeWithPortPoints> {
    if (this.winningSolver) {
      return this.winningSolver.nodeMap
    }
    const best = this.getSupervisedSolverWithBestFitness()
    if (best) {
      return best.solver.nodeMap
    }
    return new Map(this.params.inputNodes.map((n) => [n.capacityMeshNodeId, n]))
  }

  /**
   * Get assigned port points from the winning solver
   */
  get assignedPortPoints() {
    if (this.winningSolver) {
      return this.winningSolver.assignedPortPoints
    }
    const best = this.getSupervisedSolverWithBestFitness()
    if (best) {
      return best.solver.assignedPortPoints
    }
    return new Map()
  }

  /**
   * Get node assigned port points from the winning solver
   */
  get nodeAssignedPortPoints() {
    if (this.winningSolver) {
      return this.winningSolver.nodeAssignedPortPoints
    }
    const best = this.getSupervisedSolverWithBestFitness()
    if (best) {
      return best.solver.nodeAssignedPortPoints
    }
    return new Map()
  }

  /**
   * Compute board score from the winning solver
   */
  computeBoardScore(): number {
    if (this.winningSolver) {
      return this.winningSolver.computeBoardScore()
    }
    const best = this.getSupervisedSolverWithBestFitness()
    if (best) {
      return best.solver.computeBoardScore()
    }
    return 0
  }

  onSolve(solver: SupervisedSolver<PortPointPathingSolver>) {
    this.stats = {
      ...solver.solver.stats,
      winningHyperParameters: this.winningSolver?.hyperParameters,
    }
  }

  visualize(): GraphicsObject {
    if (this.winningSolver) {
      return this.winningSolver.visualize()
    }
    return super.visualize()
  }
}
