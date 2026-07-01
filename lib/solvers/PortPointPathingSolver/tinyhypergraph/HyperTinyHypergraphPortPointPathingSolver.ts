import type { GraphicsObject } from "graphics-debug"
import {
  HyperParameterSupervisorSolver,
  type HyperParameterDef,
  type SupervisedSolver,
} from "lib/solvers/HyperParameterSupervisorSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { HgPortPointPathingSolverParams } from "../hgportpointpathingsolver/types"
import {
  TinyHypergraphPortPointPathingSolver,
  type TinyHypergraphPortPointPathingSolverOptions,
} from "./TinyHypergraphPortPointPathingSolver"

export type TinyHypergraphSearchVariant = {
  name: string
  tinyParams: HgPortPointPathingSolverParams
  options?: TinyHypergraphPortPointPathingSolverOptions
}

export interface HyperTinyHypergraphPortPointPathingSolverParams {
  variants: TinyHypergraphSearchVariant[]
}

type TinyHypergraphPortPointPathingOutput = ReturnType<
  TinyHypergraphPortPointPathingSolver["getOutput"]
>

const getNumericStat = (
  stats: Record<string, unknown>,
  key: string,
): number | undefined => {
  const value = stats[key]
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined
}

const getTinyRouteQualityCost = (
  solver: TinyHypergraphPortPointPathingSolver,
): number => {
  const finalMaxRegionCost =
    getNumericStat(solver.stats, "finalMaxRegionCost") ??
    getNumericStat(solver.stats, "sectionSearchFinalMaxRegionCost")
  const baselineMaxRegionCost = getNumericStat(
    solver.stats,
    "sectionSearchBaselineMaxRegionCost",
  )
  const sectionMaskPortCount = getNumericStat(
    solver.stats,
    "sectionMaskPortCount",
  )
  const duplicateCongestedPortCount = getNumericStat(
    solver.stats,
    "duplicateCongestedPortCount",
  )

  return (
    (finalMaxRegionCost ?? baselineMaxRegionCost ?? 0) +
    (sectionMaskPortCount ?? 0) * 1e-6 +
    (duplicateCongestedPortCount ?? 0) * 1e-4
  )
}

/**
 * Searches across multiple tiny-hypergraph graph variants and returns the best
 * solved port-point pathing result.
 */
export class HyperTinyHypergraphPortPointPathingSolver extends HyperParameterSupervisorSolver<TinyHypergraphPortPointPathingSolver> {
  private readonly params: HyperTinyHypergraphPortPointPathingSolverParams
  private nextSupervisedSolverIndex = 0

  constructor(params: HyperTinyHypergraphPortPointPathingSolverParams) {
    super()
    if (params.variants.length === 0) {
      throw new Error(
        "HyperTinyHypergraphPortPointPathingSolver requires at least one variant",
      )
    }
    this.params = params
    this.MAX_ITERATIONS =
      Math.max(
        ...params.variants.map(
          (variant) =>
            (variant.options?.solveGraphOptions?.MAX_ITERATIONS ??
              2_000_000 * Math.max(variant.tinyParams.effort, 1e-2)) +
            (variant.options?.sectionSolverOptions?.MAX_ITERATIONS ??
              1_000_000 * Math.max(variant.tinyParams.effort, 1e-2)),
        ),
      ) *
      params.variants.length +
      1_000_000
    this.GREEDY_MULTIPLIER = 1
    this.MIN_SUBSTEPS = 25
  }

  override getSolverName(): string {
    return "HyperTinyHypergraphPortPointPathingSolver"
  }

  override getConstructorParams(): [HyperTinyHypergraphPortPointPathingSolverParams] {
    return [this.params]
  }

  override getHyperParameterDefs(): Array<HyperParameterDef> {
    return [
      {
        name: "TINY_VARIANT",
        possibleValues: this.params.variants.map((variant) => ({
          TINY_VARIANT: variant,
        })),
      },
    ]
  }

  override getCombinationDefs(): Array<string[]> {
    return [["TINY_VARIANT"]]
  }

  override generateSolver(hyperParameters: {
    TINY_VARIANT: TinyHypergraphSearchVariant
  }): TinyHypergraphPortPointPathingSolver {
    return new TinyHypergraphPortPointPathingSolver(
      hyperParameters.TINY_VARIANT.tinyParams,
      hyperParameters.TINY_VARIANT.options,
    )
  }

  override computeG(solver: TinyHypergraphPortPointPathingSolver): number {
    if (solver.failed) {
      return Number.POSITIVE_INFINITY
    }

    return getTinyRouteQualityCost(solver)
  }

  override computeH(solver: TinyHypergraphPortPointPathingSolver): number {
    return Math.max(0, 1 - (solver.progress || 0))
  }

  override _step(): void {
    if (!this.supervisedSolvers) {
      this.initializeSolvers()
    }

    const supervisedSolver = this.getNextRunnableSupervisedSolver()

    if (!supervisedSolver) {
      this.finishSearch()
      return
    }

    for (let i = 0; i < this.MIN_SUBSTEPS; i++) {
      if (supervisedSolver.solver.solved || supervisedSolver.solver.failed) {
        break
      }
      supervisedSolver.solver.step()
    }

    this.activeSubSolver = supervisedSolver.solver
    supervisedSolver.g = this.computeG(supervisedSolver.solver)
    supervisedSolver.h = this.computeH(supervisedSolver.solver)
    supervisedSolver.f = this.computeF(supervisedSolver.g, supervisedSolver.h)
  }

  override getFailureMessage(): string {
    return `All tiny hypergraph search variants failed. Example failures: ${this.supervisedSolvers
      ?.slice(0, 5)
      .map((supervisedSolver) => {
        const variantName = this.getVariantName(supervisedSolver)
        return `${variantName}: ${supervisedSolver.solver.error ?? "unknown error"}`
      })
      .join(", ")}`
  }

  override onSolve(
    supervisedSolver: SupervisedSolver<TinyHypergraphPortPointPathingSolver>,
  ): void {
    this.stats = {
      ...supervisedSolver.solver.stats,
      winningTinyHypergraphVariant: this.getVariantName(supervisedSolver),
    }
  }

  getOutput(): TinyHypergraphPortPointPathingOutput {
    return this.getSelectedSolver().getOutput()
  }

  computeNodePf(node: InputNodeWithPortPoints): number | null {
    return this.getSelectedSolver().computeNodePf(node)
  }

  getNodesWithPortPoints(): NodeWithPortPoints[] {
    return this.getOutput().nodesWithPortPoints
  }

  override visualize(): GraphicsObject {
    return this.getSelectedSolverOrNull()?.visualize() ?? super.visualize()
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }

  private getSelectedSolver(): TinyHypergraphPortPointPathingSolver {
    const solver = this.getSelectedSolverOrNull()

    if (solver) {
      return solver
    }

    throw new Error(
      `${this.getSolverName()}: no tiny hypergraph variant has been initialized`,
    )
  }

  private getSelectedSolverOrNull(): TinyHypergraphPortPointPathingSolver | null {
    if (this.winningSolver) {
      return this.winningSolver
    }

    const bestSolver = this.getSupervisedSolverWithBestFitness()?.solver
    if (bestSolver) {
      return bestSolver
    }

    return null
  }

  private getVariantName(
    supervisedSolver: SupervisedSolver<TinyHypergraphPortPointPathingSolver>,
  ): string {
    const variant = supervisedSolver.hyperParameters.TINY_VARIANT
    return typeof variant?.name === "string" ? variant.name : "unknown"
  }

  private getNextRunnableSupervisedSolver():
    | SupervisedSolver<TinyHypergraphPortPointPathingSolver>
    | null {
    const supervisedSolvers = this.supervisedSolvers ?? []

    for (let offset = 0; offset < supervisedSolvers.length; offset++) {
      const index =
        (this.nextSupervisedSolverIndex + offset) % supervisedSolvers.length
      const supervisedSolver = supervisedSolvers[index]

      if (
        supervisedSolver &&
        !supervisedSolver.solver.solved &&
        !supervisedSolver.solver.failed
      ) {
        this.nextSupervisedSolverIndex = (index + 1) % supervisedSolvers.length
        return supervisedSolver
      }
    }

    return null
  }

  private finishSearch(): void {
    const solvedSupervisedSolvers = (this.supervisedSolvers ?? []).filter(
      (supervisedSolver) =>
        supervisedSolver.solver.solved && !supervisedSolver.solver.failed,
    )

    if (solvedSupervisedSolvers.length === 0) {
      this.failed = true
      this.error = this.getFailureMessage()
      return
    }

    const winningSupervisedSolver = solvedSupervisedSolvers.reduce(
      (bestSolver, supervisedSolver) =>
        getTinyRouteQualityCost(supervisedSolver.solver) <
        getTinyRouteQualityCost(bestSolver.solver)
          ? supervisedSolver
          : bestSolver,
    )

    this.solved = true
    this.winningSolver = winningSupervisedSolver.solver
    this.onSolve(winningSupervisedSolver)
  }
}
