import { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "./BaseSolver"

export type SupervisedSolver<T extends BaseSolver> = {
  hyperParameters: any
  solver: T
  h: number
  g: number
  f: number
}

export type HyperParameterDef = {
  name: string
  possibleValues: Array<any>
}

/**
 * The HyperParameterSupervisorSolver is a solver that solves a problem by
 * running competing solvers with different hyperparameters.
 *
 * As solvers make progress, the supervisor will allow the best solvers to run
 * for more iterations, prioritizing the solvers that are working the best.
 */
export class HyperParameterSupervisorSolver<
  T extends BaseSolver,
> extends BaseSolver {
  GREEDY_MULTIPLIER = 1.2
  MIN_SUBSTEPS = 1

  supervisedSolvers?: Array<SupervisedSolver<T>>
  winningSolver?: T

  getHyperParameterDefs(): Array<HyperParameterDef> {
    throw new Error("Not implemented")
  }

  getCombinationDefs(): Array<Array<string>> | null {
    return null
  }

  getHyperParameterCombinations(
    hyperParameterDefs?: Array<HyperParameterDef>,
  ): Array<Record<string, any>> {
    if (!hyperParameterDefs) {
      hyperParameterDefs = this.getHyperParameterDefs()
    }
    const combinations: Array<Record<string, any>> = []
    // Base case - no more hyperparameters to combine
    if (hyperParameterDefs.length === 0) {
      return [{}]
    }

    // Take first hyperparameter definition
    const [currentDef, ...remainingDefs] = hyperParameterDefs

    // Get combinations for remaining hyperparameters
    const subCombinations = this.getHyperParameterCombinations(remainingDefs)

    // For each possible value of current hyperparameter,
    // combine with all sub-combinations
    currentDef.possibleValues.forEach((value) => {
      subCombinations.forEach((subCombo) => {
        combinations.push({
          ...subCombo,
          ...value,
        })
      })
    })

    return combinations
  }

  initializeSolvers() {
    const hyperParameterDefs = this.getHyperParameterDefs()

    const combinationDefs = this.getCombinationDefs() ?? [
      hyperParameterDefs.map((def) => def.name),
    ]

    this.supervisedSolvers = []
    for (const combinationDef of combinationDefs) {
      const hyperParameterCombinations = this.getHyperParameterCombinations(
        hyperParameterDefs.filter((hpd) => combinationDef.includes(hpd.name)),
      )

      for (const hyperParameters of hyperParameterCombinations) {
        const solver = this.generateSolver(hyperParameters)
        const g = this.computeG(solver)
        this.supervisedSolvers.push({
          hyperParameters,
          solver,
          h: 0,
          g,
          f: g,
        })
      }
    }
  }

  generateSolver(hyperParameters: any): T {
    throw new Error("Not implemented")
  }

  computeG(solver: T) {
    return solver.iterations / solver.MAX_ITERATIONS
  }

  computeH(solver: T) {
    return 1 - (solver.progress || 0)
  }

  computeF(g: number, h: number) {
    return g + h * this.GREEDY_MULTIPLIER
  }

  getSupervisedSolverWithBestFitness(): SupervisedSolver<T> | null {
    let bestFitness = Infinity
    let bestSolver: SupervisedSolver<T> | null = null
    for (const supervisedSolver of this.supervisedSolvers ?? []) {
      if (supervisedSolver.solver.solved) {
        return supervisedSolver
      }
      if (supervisedSolver.solver.failed) {
        continue
      }
      const fitness = supervisedSolver.f
      if (fitness < bestFitness) {
        bestFitness = fitness
        bestSolver = supervisedSolver
      }
    }
    return bestSolver
  }

  getFailureMessage() {
    return `All solvers failed in hyper solver. Example failures: ${this.supervisedSolvers
      ?.sort((a, b) => b.f - a.f)
      ?.slice(0, 5)
      .map((s) => s.solver.error)
      .join(", ")}`
  }

  _step() {
    if (!this.supervisedSolvers) this.initializeSolvers()

    const supervisedSolver = this.getSupervisedSolverWithBestFitness()

    if (!supervisedSolver) {
      this.failed = true
      this.error = this.getFailureMessage()
      return
    }

    for (let i = 0; i < this.MIN_SUBSTEPS; i++) {
      supervisedSolver.solver.step()
    }
    this.activeSubSolver = supervisedSolver.solver

    supervisedSolver.g = this.computeG(supervisedSolver.solver)
    supervisedSolver.h = this.computeH(supervisedSolver.solver)
    supervisedSolver.f = this.computeF(supervisedSolver.g, supervisedSolver.h)

    if (supervisedSolver.solver.solved) {
      this.solved = true
      this.winningSolver = supervisedSolver.solver
      this.onSolve?.(supervisedSolver)
    }
  }

  onSolve(solver: SupervisedSolver<T>) {}

  visualize(): GraphicsObject {
    const bestSupervisedSolver = this.getSupervisedSolverWithBestFitness()
    let graphics: GraphicsObject = {
      lines: [],
      circles: [],
      points: [],
      rects: [],
    }

    if (bestSupervisedSolver) {
      graphics = bestSupervisedSolver.solver.visualize()
    }
    return graphics
  }
}
