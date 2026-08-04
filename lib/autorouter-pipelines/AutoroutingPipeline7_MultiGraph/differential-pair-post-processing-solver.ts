import {
  LengthMatchingSolver,
  type NonIdealPostProcessingIssue,
  PostProcessingSolver,
  type PostProcessingSolverParams,
} from "@tscircuit/length-matching-solver"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../../solvers/BaseSolver"

type DifferentialPairPostProcessingSolverParams = PostProcessingSolverParams & {
  obstacleMargin?: number
}

export type NonIdealRouteIssue = {
  type: "post_processing_error"
  stage: "length-matching" | "coupled-rerouting"
  postProcessingStage?: string
  message: string
  connectionName?: string
  returnedRouteSource: "post-processing-input" | "length-matched"
}

export type DifferentialPairPostProcessingSolverOutput = {
  hdRoutes: PostProcessingSolverParams["hdRoutes"]
  nonIdealRouteIssues?: NonIdealRouteIssue[]
}

/** Applies the post-processing algorithm implied by each pair's constraints. */
export class DifferentialPairPostProcessingSolver extends BaseSolver {
  readonly lengthMatchingSolver?: LengthMatchingSolver
  postProcessingSolver?: PostProcessingSolver
  private readonly lengthOnlyPairs: PostProcessingSolverParams["differentialPairs"]
  private readonly coupledPairs: PostProcessingSolverParams["differentialPairs"]
  private phase: "length-matching" | "coupled-rerouting" | "complete" =
    "complete"
  private outputHdRoutes?: PostProcessingSolverParams["hdRoutes"]
  private readonly nonIdealRouteIssues: NonIdealRouteIssue[] = []

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
      try {
        this.lengthMatchingSolver = new LengthMatchingSolver({
          hdRoutes: inputProblem.hdRoutes,
          originalConnections,
          differentialPairs: this.lengthOnlyPairs,
          obstacles: inputProblem.obstacles,
          bounds: inputProblem.bounds,
          layerCount: inputProblem.layerCount,
          obstacleMargin: inputProblem.obstacleMargin,
        })
      } catch (error) {
        this.finishWithNonIdealOutput(
          error,
          "length-matching",
          inputProblem.hdRoutes,
          "post-processing-input",
        )
        return
      }
      this.phase = "length-matching"
      this.MAX_ITERATIONS = this.lengthMatchingSolver.MAX_ITERATIONS + 2
      return
    }
    this.phase = "coupled-rerouting"
    this.startPostProcessing(inputProblem.hdRoutes, "post-processing-input")
  }

  override getSolverName(): string {
    return "DifferentialPairPostProcessingSolver"
  }

  override _step(): void {
    if (this.phase === "length-matching") {
      try {
        this.lengthMatchingSolver!.step()
      } catch (error) {
        this.finishWithNonIdealOutput(
          error,
          "length-matching",
          this.inputProblem.hdRoutes,
          "post-processing-input",
        )
        return
      }
      this.progress = this.lengthMatchingSolver!.progress
      this.stats = {
        phase: "length-matching",
        ...this.lengthMatchingSolver!.stats,
      }
      if (this.lengthMatchingSolver!.failed) {
        this.finishWithNonIdealOutput(
          this.lengthMatchingSolver!.error ??
            "LengthMatchingSolver failed without an error message",
          "length-matching",
          this.inputProblem.hdRoutes,
          "post-processing-input",
        )
        return
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
      this.phase = "coupled-rerouting"
      this.startPostProcessing(matchedHdRoutes, "length-matched")
      return
    }

    if (this.phase === "coupled-rerouting") {
      try {
        this.postProcessingSolver!.step()
      } catch (error) {
        this.finishWithNonIdealOutput(
          error,
          "coupled-rerouting",
          this.postProcessingSolver!.inputProblem.hdRoutes,
          this.lengthOnlyPairs.length > 0
            ? "length-matched"
            : "post-processing-input",
        )
        return
      }
      this.progress = this.postProcessingSolver!.progress
      this.stats = {
        phase: "coupled-rerouting",
        ...this.postProcessingSolver!.stats,
      }
      if (this.postProcessingSolver!.failed) {
        this.finishWithNonIdealOutput(
          this.postProcessingSolver!.error ??
            "PostProcessingSolver failed without an error message",
          "coupled-rerouting",
          this.postProcessingSolver!.inputProblem.hdRoutes,
          this.lengthOnlyPairs.length > 0
            ? "length-matched"
            : "post-processing-input",
        )
        return
      }
      if (!this.postProcessingSolver!.solved) return
      const output = this.postProcessingSolver!.getOutput({
        includeNonIdealRouteIssues: true,
      })
      this.outputHdRoutes = output.hdRoutes
      this.recordPostProcessingIssues(
        output.nonIdealRouteIssues ?? [],
        this.lengthOnlyPairs.length > 0
          ? "length-matched"
          : "post-processing-input",
      )
      this.phase = "complete"
      this.solved = true
      this.progress = 1
    }
  }

  private startPostProcessing(
    hdRoutes: PostProcessingSolverParams["hdRoutes"],
    returnedRouteSource: NonIdealRouteIssue["returnedRouteSource"],
  ): void {
    try {
      this.postProcessingSolver = new PostProcessingSolver({
        ...this.inputProblem,
        hdRoutes,
        differentialPairs: this.coupledPairs,
        allowNonIdealOutput: true,
      })
      this.MAX_ITERATIONS += this.postProcessingSolver.MAX_ITERATIONS + 1
    } catch (error) {
      this.finishWithNonIdealOutput(
        error,
        "coupled-rerouting",
        hdRoutes,
        returnedRouteSource,
      )
    }
  }

  private recordPostProcessingIssues(
    issues: NonIdealPostProcessingIssue[],
    returnedRouteSource: NonIdealRouteIssue["returnedRouteSource"],
  ): void {
    for (const issue of issues)
      this.nonIdealRouteIssues.push({
        type: issue.type,
        stage: "coupled-rerouting",
        postProcessingStage: issue.stage,
        message: issue.message,
        ...(issue.connectionName
          ? { connectionName: issue.connectionName }
          : {}),
        returnedRouteSource,
      })
  }

  private finishWithNonIdealOutput(
    error: unknown,
    stage: NonIdealRouteIssue["stage"],
    hdRoutes: PostProcessingSolverParams["hdRoutes"],
    returnedRouteSource: NonIdealRouteIssue["returnedRouteSource"],
  ): void {
    const message = error instanceof Error ? error.message : String(error)
    const connectionName = message.match(/(?:HD route|connection) "([^"]+)"/)?.[1]
    this.nonIdealRouteIssues.push({
      type: "post_processing_error",
      stage,
      message,
      ...(connectionName ? { connectionName } : {}),
      returnedRouteSource,
    })
    this.outputHdRoutes = structuredClone(hdRoutes)
    this.phase = "complete"
    this.stats = { phase: "complete", nonIdealRouteIssueCount: 1 }
    this.progress = 1
    this.solved = true
  }

  override getConstructorParams(): [
    DifferentialPairPostProcessingSolverParams,
  ] {
    return [this.inputProblem]
  }

  getOutput(options: {
    includeNonIdealRouteIssues?: boolean
  } = {}): DifferentialPairPostProcessingSolverOutput {
    if (!this.solved || !this.outputHdRoutes)
      throw new Error(
        "DifferentialPairPostProcessingSolver: getOutput() called before completion",
      )
    return {
      hdRoutes: structuredClone(this.outputHdRoutes),
      ...(options.includeNonIdealRouteIssues
        ? { nonIdealRouteIssues: structuredClone(this.nonIdealRouteIssues) }
        : {}),
    }
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
