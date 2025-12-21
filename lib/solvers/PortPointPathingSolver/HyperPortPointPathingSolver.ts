import type { GraphicsObject } from "graphics-debug"
import {
  HyperParameterSupervisorSolver,
  type HyperParameterDef,
} from "../HyperParameterSupervisorSolver"
import {
  PortPointPathingSolver,
  type InputNodeWithPortPoints,
} from "./PortPointPathingSolver"
import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "../../types"
import type { NodeWithPortPoints } from "../../types/high-density-types"

interface HyperPortPointPathingSolverParams {
  simpleRouteJson: SimpleRouteJson
  capacityMeshNodes: CapacityMeshNode[]
  inputNodes: InputNodeWithPortPoints[]
  colorMap?: Record<string, string>
  nodeMemoryPfMap?: Map<CapacityMeshNodeId, number>
  numShuffleSeeds?: number
}

export class HyperPortPointPathingSolver extends HyperParameterSupervisorSolver<PortPointPathingSolver> {
  private params: HyperPortPointPathingSolverParams

  constructor(params: HyperPortPointPathingSolverParams) {
    super()
    this.params = params
    this.MAX_ITERATIONS = 100e6
    this.GREEDY_MULTIPLIER = 1
    // Each sub-solver runs 100 steps before we switch
    this.MIN_SUBSTEPS = 1
  }

  getHyperParameterDefs(): Array<HyperParameterDef> {
    const numSeeds = this.params.numShuffleSeeds ?? 900
    const shuffleSeeds = Array.from({ length: numSeeds }, (_, i) => ({
      SHUFFLE_SEED: i,
    }))

    return [
      {
        name: "SHUFFLE_SEED",
        possibleValues: shuffleSeeds,
      },
    ]
  }

  generateSolver(hyperParameters: {
    SHUFFLE_SEED: number
  }): PortPointPathingSolver {
    return new PortPointPathingSolver({
      simpleRouteJson: this.params.simpleRouteJson,
      capacityMeshNodes: this.params.capacityMeshNodes,
      inputNodes: this.params.inputNodes,
      colorMap: this.params.colorMap,
      nodeMemoryPfMap: this.params.nodeMemoryPfMap,
      hyperParameters: {
        SHUFFLE_SEED: hyperParameters.SHUFFLE_SEED,
      },
    })
  }

  /**
   * G measures how much "resource" (iterations) we've spent on this solver
   */
  computeG(solver: PortPointPathingSolver): number {
    const boardScore = solver.computeBoardScore()
    return solver.iterations // + boardScore * 100
  }

  /**
   * H estimates how much work is remaining.
   * We use the fraction of connections not yet routed.
   */
  computeH(solver: PortPointPathingSolver): number {
    const totalConnections = solver.connectionsWithResults.length
    if (totalConnections === 0) return 1

    const completedConnections = solver.currentConnectionIndex
    const remainingConnections = totalConnections - completedConnections
    // Assume it takes 100 iterations to route a single connection
    return (
      remainingConnections * 100 -
      solver.computeBoardScore() * remainingConnections
    )
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

  visualize(): GraphicsObject {
    if (this.winningSolver) {
      return this.winningSolver.visualize()
    }
    return super.visualize()
  }
}
