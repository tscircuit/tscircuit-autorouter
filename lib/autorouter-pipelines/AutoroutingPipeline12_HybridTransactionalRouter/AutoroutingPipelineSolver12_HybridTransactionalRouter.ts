import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  SimpleRouteJson,
  SimplifiedPcbTraces,
} from "../../types"
import { convertSrjToGraphicsObject } from "../../utils/convertSrjToGraphicsObject"
import {
  HybridTransactionalRegionalRouter,
  type HybridTransactionalRegionalRouterOptions,
} from "./hybrid-transactional-regional-router"
import type { HybridRouterResult } from "./types"
import type { HybridRoutingVisualization } from "./visualization"
import type { SerialHybridEngineResult } from "./serial-engine-types"

export type AutoroutingPipelineSolver12HybridTransactionalRouterOptions =
  HybridTransactionalRegionalRouterOptions

export class AutoroutingPipelineSolver12_HybridTransactionalRouter extends BaseSolver {
  private readonly inputSrj: SimpleRouteJson
  private readonly options: AutoroutingPipelineSolver12HybridTransactionalRouterOptions
  private readonly router: HybridTransactionalRegionalRouter
  private activeSolve?: Promise<void>
  private result?: HybridRouterResult

  constructor(
    inputSrj: SimpleRouteJson,
    options: AutoroutingPipelineSolver12HybridTransactionalRouterOptions,
  ) {
    super()
    this.inputSrj = inputSrj
    this.options = options
    this.router = new HybridTransactionalRegionalRouter(inputSrj, options)
    this.MAX_ITERATIONS = 1
  }

  override getSolverName(): string {
    return "AutoroutingPipelineSolver12_HybridTransactionalRouter"
  }

  override getConstructorParams(): readonly [
    SimpleRouteJson,
    AutoroutingPipelineSolver12HybridTransactionalRouterOptions,
  ] {
    return [this.inputSrj, this.options] as const
  }

  override _step(): void {
    throw new Error(
      "AutoroutingPipelineSolver12_HybridTransactionalRouter requires async execution. Use solveAsync() or stepAsync().",
    )
  }

  override solve(): void {
    throw new Error(
      "AutoroutingPipelineSolver12_HybridTransactionalRouter requires async execution. Use solveAsync() or stepAsync().",
    )
  }

  async stepAsync(): Promise<void> {
    if (this.solved || this.failed) return
    if (!this.activeSolve) {
      const startedAt = performance.now()
      this.activeSolve = this.router.route().then((result) => {
        this.result = result
        this.progress = 1
        this.timeToSolve = performance.now() - startedAt
        this.stats = { ...result.metrics }
        if (result.status === "solved") {
          this.solved = true
          return
        }
        this.failed = true
        this.error = result.diagnostic.message
      })
    }
    await this.activeSolve
  }

  async solveAsync(): Promise<void> {
    await this.stepAsync()
  }

  getResult(): HybridRouterResult | undefined {
    return this.result
  }

  getVisualizations(): readonly HybridRoutingVisualization[] {
    return this.router.getVisualizations()
  }

  getLastEngineResult(): SerialHybridEngineResult | undefined {
    return this.router.getLastEngineResult()
  }

  override getOutput(): SimpleRouteJson {
    if (this.result?.status !== "solved") {
      throw new Error("Pipeline 12 does not have a verified solved output")
    }
    return this.result.routedSimpleRouteJson
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return this.getOutput()
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    return this.getOutput().traces ?? []
  }

  override visualize(): GraphicsObject {
    if (this.result?.status === "solved") {
      return convertSrjToGraphicsObject(this.result.routedSimpleRouteJson)
    }
    if (this.result?.status === "partial") {
      return convertSrjToGraphicsObject(this.result.partialSimpleRouteJson)
    }
    return convertSrjToGraphicsObject(this.inputSrj)
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }
}
