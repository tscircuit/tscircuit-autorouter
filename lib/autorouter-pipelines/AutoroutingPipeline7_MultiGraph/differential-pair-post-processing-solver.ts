import {
  LengthMatchingSolver,
  PostProcessingSolver,
  type PostProcessingSolverOutput,
  type PostProcessingSolverParams,
} from "@tscircuit/length-matching-solver"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../../solvers/BaseSolver"

type DifferentialPairPostProcessingSolverParams = PostProcessingSolverParams & {
  obstacleMargin?: number
}

/** Applies the post-processing algorithm implied by each pair's constraints. */
export class DifferentialPairPostProcessingSolver extends BaseSolver {
  readonly lengthMatchingSolver?: LengthMatchingSolver
  postProcessingSolver?: PostProcessingSolver
  private readonly lengthOnlyPairs: PostProcessingSolverParams["differentialPairs"]
  private readonly coupledPairs: PostProcessingSolverParams["differentialPairs"]
  private phase: "length-matching" | "coupled-rerouting" | "complete"
  private outputHdRoutes?: PostProcessingSolverParams["hdRoutes"]

  constructor(
    public readonly inputProblem: DifferentialPairPostProcessingSolverParams,
  ) {
    super()
    this.lengthOnlyPairs = inputProblem.differentialPairs.filter(
      (pair) =>
        pair.minimumCenterlineDistance === undefined &&
        pair.maximumCenterlineDistance === undefined,
    )
    this.coupledPairs = inputProblem.differentialPairs.filter(
      (pair) =>
        pair.minimumCenterlineDistance !== undefined ||
        pair.maximumCenterlineDistance !== undefined,
    )
    if (this.lengthOnlyPairs.length > 0) {
      const originalConnections = this.lengthOnlyPairs.flatMap((pair) =>
        pair.connectionNames.map((connectionName) => {
          const matchingRoutes = inputProblem.hdRoutes.filter(
            (route) => route.connectionName === connectionName,
          )
          if (matchingRoutes.length !== 1)
            throw new Error(
              `DifferentialPairPostProcessingSolver: connection "${connectionName}" must resolve to exactly one HD route`,
            )
          const route = matchingRoutes[0]!
          const start = route.route[0]
          const end = route.route.at(-1)
          if (!start || !end)
            throw new Error(
              `DifferentialPairPostProcessingSolver: connection "${connectionName}" has incomplete routed geometry`,
            )
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
    this.postProcessingSolver = new PostProcessingSolver({
      ...inputProblem,
      differentialPairs: this.coupledPairs,
    })
    this.phase = "coupled-rerouting"
    this.MAX_ITERATIONS = this.postProcessingSolver.MAX_ITERATIONS + 1
  }

  override getSolverName(): string {
    return "DifferentialPairPostProcessingSolver"
  }

  override _step(): void {
    if (this.phase === "length-matching") {
      this.lengthMatchingSolver!.step()
      this.progress = this.lengthMatchingSolver!.progress
      this.stats = {
        phase: "length-matching",
        ...this.lengthMatchingSolver!.stats,
      }
      if (!this.lengthMatchingSolver!.solved) return
      const matchedHdRoutes =
        this.lengthMatchingSolver!.getOutput().matchedHdRoutes
      if (this.coupledPairs.length === 0) {
        this.outputHdRoutes = matchedHdRoutes
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
      return
    }

    if (this.phase === "coupled-rerouting") {
      this.postProcessingSolver!.step()
      this.progress = this.postProcessingSolver!.progress
      this.stats = {
        phase: "coupled-rerouting",
        ...this.postProcessingSolver!.stats,
      }
      if (!this.postProcessingSolver!.solved) return
      this.outputHdRoutes = this.postProcessingSolver!.getOutput().hdRoutes
      this.phase = "complete"
      this.solved = true
      this.progress = 1
    }
  }

  override getConstructorParams(): [
    DifferentialPairPostProcessingSolverParams,
  ] {
    return [this.inputProblem]
  }

  getOutput(): PostProcessingSolverOutput {
    if (!this.solved || !this.outputHdRoutes)
      throw new Error(
        "DifferentialPairPostProcessingSolver: getOutput() called before completion",
      )
    return { hdRoutes: structuredClone(this.outputHdRoutes) }
  }

  override visualize(): GraphicsObject {
    if (this.phase === "length-matching")
      return this.lengthMatchingSolver!.visualize()
    return (
      this.postProcessingSolver?.visualize() ??
      this.lengthMatchingSolver!.visualize()
    )
  }
}
