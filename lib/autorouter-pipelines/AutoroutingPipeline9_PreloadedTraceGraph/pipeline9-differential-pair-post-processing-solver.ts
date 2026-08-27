import {
  LengthMatchingSolver,
  LengthMatchingNoSolutionError,
  PostProcessingSolver,
  type PostProcessingSolverOutput,
  type PostProcessingSolverParams,
} from "@tscircuit/length-matching-solver"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../../solvers/BaseSolver"

export type Pipeline9DifferentialPairPostProcessingSolverParams =
  PostProcessingSolverParams & {
    obstacleMargin: number
  }

/** Length-matches unconstrained pairs before applying coupled-pair rerouting. */
export class Pipeline9DifferentialPairPostProcessingSolver extends BaseSolver {
  readonly lengthMatchingSolver?: LengthMatchingSolver
  postProcessingSolver?: PostProcessingSolver
  private readonly lengthOnlyPairs: PostProcessingSolverParams["differentialPairs"]
  private readonly coupledPairs: PostProcessingSolverParams["differentialPairs"]
  private readonly validatedPostProcessingSolver: PostProcessingSolver
  private phase: "length-matching" | "coupled-rerouting" | "complete"
  private output?: PostProcessingSolverOutput

  constructor(
    public readonly inputProblem: Pipeline9DifferentialPairPostProcessingSolverParams,
  ) {
    super()
    this.validatedPostProcessingSolver = new PostProcessingSolver(inputProblem)
    const lengthOnlyPairs: PostProcessingSolverParams["differentialPairs"] = []
    const coupledPairs: PostProcessingSolverParams["differentialPairs"] = []
    for (const pair of inputProblem.differentialPairs) {
      const usesOnlyLengthConstraint =
        pair.minimumCenterlineDistance === undefined &&
        pair.maximumCenterlineDistance === undefined &&
        pair.maxUncoupledLength === undefined
      const hasDirectLengthMatchingRoutes = pair.connectionNames.every(
        (connectionName) => {
          const matchingRoutes = inputProblem.hdRoutes.filter(
            (route) => route.connectionName === connectionName,
          )
          return (
            matchingRoutes.length === 1 && matchingRoutes[0]!.route.length > 0
          )
        },
      )
      if (usesOnlyLengthConstraint && hasDirectLengthMatchingRoutes)
        lengthOnlyPairs.push(pair)
      else coupledPairs.push(pair)
    }
    this.lengthOnlyPairs = lengthOnlyPairs
    this.coupledPairs = coupledPairs
    if (this.validatedPostProcessingSolver.solved) {
      this.postProcessingSolver = this.validatedPostProcessingSolver
      this.output = this.validatedPostProcessingSolver.getOutput()
      this.phase = "complete"
      this.solved = true
      this.progress = 1
      this.MAX_ITERATIONS = 1
      return
    }
    if (this.lengthOnlyPairs.length > 0) {
      const originalConnections = this.lengthOnlyPairs.flatMap((pair) =>
        pair.connectionNames.map((connectionName) => {
          const route = inputProblem.hdRoutes.find(
            (route) => route.connectionName === connectionName,
          )!
          const start = route.route[0]!
          const end = route.route.at(-1)!
          return {
            name: connectionName,
            pointsToConnect: [
              { x: start.x, y: start.y, layer: `z${start.z}` },
              { x: end.x, y: end.y, layer: `z${end.z}` },
            ],
          }
        }),
      )
      this.lengthMatchingSolver = new LengthMatchingSolver({
        hdRoutes: inputProblem.hdRoutes,
        originalConnections,
        differentialPairs: this.lengthOnlyPairs,
        obstacles: inputProblem.obstacles,
        bounds: inputProblem.bounds,
        layerCount: inputProblem.layerCount,
        obstacleMargin: inputProblem.obstacleMargin,
      })
      this.phase = "length-matching"
      this.MAX_ITERATIONS = this.lengthMatchingSolver.MAX_ITERATIONS + 2
      return
    }
    this.postProcessingSolver = this.validatedPostProcessingSolver
    this.phase = "coupled-rerouting"
    this.MAX_ITERATIONS = this.postProcessingSolver.MAX_ITERATIONS + 1
  }

  override getSolverName(): string {
    return "Pipeline9DifferentialPairPostProcessingSolver"
  }

  private startBestEffortPostProcessing(): void {
    this.postProcessingSolver = this.validatedPostProcessingSolver
    this.MAX_ITERATIONS += this.postProcessingSolver.MAX_ITERATIONS + 1
    this.phase = "coupled-rerouting"
    this.progress = 0
    this.stats = { phase: "best-effort-post-processing" }
  }

  override _step(): void {
    if (this.phase === "length-matching") {
      try {
        this.lengthMatchingSolver!.step()
      } catch (error) {
        if (!(error instanceof LengthMatchingNoSolutionError)) throw error
        this.startBestEffortPostProcessing()
        return
      }
      this.progress = this.lengthMatchingSolver!.progress
      this.stats = {
        phase: "length-matching",
        ...this.lengthMatchingSolver!.stats,
      }
      if (this.lengthMatchingSolver!.failed) {
        this.startBestEffortPostProcessing()
        return
      }
      if (!this.lengthMatchingSolver!.solved) return
      const matchedHdRoutes =
        this.lengthMatchingSolver!.getOutput().matchedHdRoutes
      if (this.coupledPairs.length === 0) {
        this.output = { hdRoutes: matchedHdRoutes, postProcessingErrors: [] }
        this.phase = "complete"
        this.solved = true
        this.progress = 1
        return
      }
      this.postProcessingSolver = new PostProcessingSolver({
        ...this.inputProblem,
        hdRoutes: matchedHdRoutes,
        differentialPairs: this.coupledPairs,
      })
      this.MAX_ITERATIONS += this.postProcessingSolver.MAX_ITERATIONS + 1
      this.phase = "coupled-rerouting"
      this.progress = 0
      this.stats = { phase: "coupled-rerouting" }
      return
    }

    if (this.phase === "coupled-rerouting") {
      this.postProcessingSolver!.step()
      this.progress = this.postProcessingSolver!.progress
      this.stats = {
        phase: "coupled-rerouting",
        ...this.postProcessingSolver!.stats,
      }
      if (this.postProcessingSolver!.failed) {
        this.failed = true
        this.error = this.postProcessingSolver!.error
        return
      }
      if (!this.postProcessingSolver!.solved) return
      this.output = this.postProcessingSolver!.getOutput()
      this.phase = "complete"
      this.solved = true
      this.progress = 1
    }
  }

  override getConstructorParams(): [
    Pipeline9DifferentialPairPostProcessingSolverParams,
  ] {
    return [this.inputProblem]
  }

  getOutput(): PostProcessingSolverOutput {
    if (!this.solved || !this.output)
      throw new Error(
        "Pipeline9DifferentialPairPostProcessingSolver: getOutput() called before completion",
      )
    return structuredClone(this.output)
  }

  override visualize(): GraphicsObject {
    if (this.phase === "length-matching")
      return this.lengthMatchingSolver!.visualize()
    return (
      this.postProcessingSolver?.visualize() ??
      this.lengthMatchingSolver?.visualize() ?? { lines: [] }
    )
  }
}
