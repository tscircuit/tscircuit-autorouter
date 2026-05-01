import {
  KiCadRoutingToolsAutorouter,
  type KiCadRoutingToolsAutorouterOptions,
} from "@tscircuit/krt-wasm"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { filterObstaclesOutsideBoard } from "lib/utils/filterObstaclesOutsideBoard"

export interface KrtAutoroutingPipelineSolverOptions {
  effort?: number
  krtOptions?: KiCadRoutingToolsAutorouterOptions
}

class KrtAutorouterSolver extends BaseSolver {
  MAX_ITERATIONS = 1
  traces: SimplifiedPcbTraces = []
  private router?: KiCadRoutingToolsAutorouter

  constructor(
    public readonly srj: SimpleRouteJson,
    public readonly opts: KrtAutoroutingPipelineSolverOptions = {},
  ) {
    super()
  }

  getConstructorParams() {
    return [this.srj, this.opts] as const
  }

  _step() {
    const effort = this.opts.effort ?? 1
    this.router = new KiCadRoutingToolsAutorouter(this.srj as any, {
      clearance: this.srj.defaultObstacleMargin ?? 0.2,
      maxIterations: Math.max(300_000, Math.round(300_000 * effort)),
      ...this.opts.krtOptions,
    })
    this.traces = this.router.solveSync() as SimplifiedPcbTraces
    this.stats.traceCount = this.traces.length
    this.solved = true
  }

  visualize(): GraphicsObject {
    return convertSrjToGraphicsObject({
      ...this.srj,
      traces: this.traces,
    })
  }
}

export class KrtAutoroutingPipelineSolver extends BaseSolver {
  krtAutorouterSolver?: KrtAutorouterSolver
  activeSubSolver?: BaseSolver | null = null
  currentPipelineStepIndex = 0
  startTimeOfPhase: Record<string, number> = {}
  endTimeOfPhase: Record<string, number> = {}
  timeSpentOnPhase: Record<string, number> = {}

  pipelineDef = [
    {
      solverName: "krtAutorouterSolver",
      solverClass: KrtAutorouterSolver,
      getConstructorParams: (pipeline: KrtAutoroutingPipelineSolver) =>
        [pipeline.srj, pipeline.opts] as const,
    },
  ]

  constructor(
    public readonly inputSrj: SimpleRouteJson,
    public readonly opts: KrtAutoroutingPipelineSolverOptions = {},
  ) {
    super()
    this.srj = addApproximatingRectsToSrj(filterObstaclesOutsideBoard(inputSrj))
  }

  srj: SimpleRouteJson

  getConstructorParams() {
    return [this.inputSrj, this.opts] as const
  }

  _step() {
    const pipelineStepDef = this.pipelineDef[this.currentPipelineStepIndex]
    if (!pipelineStepDef) {
      this.solved = true
      return
    }

    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        this.endTimeOfPhase[pipelineStepDef.solverName] = performance.now()
        this.timeSpentOnPhase[pipelineStepDef.solverName] =
          this.endTimeOfPhase[pipelineStepDef.solverName] -
          this.startTimeOfPhase[pipelineStepDef.solverName]
        this.activeSubSolver = null
        this.currentPipelineStepIndex++
      } else if (this.activeSubSolver.failed) {
        this.error = this.activeSubSolver.error
        this.failed = true
        this.activeSubSolver = null
      }
      return
    }

    const constructorParams = pipelineStepDef.getConstructorParams(this)
    this.activeSubSolver = new pipelineStepDef.solverClass(...constructorParams)
    ;(this as any)[pipelineStepDef.solverName] = this.activeSubSolver
    this.timeSpentOnPhase[pipelineStepDef.solverName] = 0
    this.startTimeOfPhase[pipelineStepDef.solverName] = performance.now()
  }

  solveUntilPhase(phase: string) {
    while (this.getCurrentPhase() !== phase && !this.solved && !this.failed) {
      this.step()
    }
  }

  getCurrentPhase(): string {
    return this.pipelineDef[this.currentPipelineStepIndex]?.solverName ?? "none"
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    if (!this.solved || !this.krtAutorouterSolver) {
      throw new Error("Cannot get output before solving is complete")
    }
    return this.krtAutorouterSolver.traces
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return {
      ...this.srj,
      traces: this.getOutputSimplifiedPcbTraces(),
    }
  }

  visualize(): GraphicsObject {
    if (!this.solved && this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }

    const inputViz = convertSrjToGraphicsObject(this.srj)
    if (!this.solved) {
      return inputViz
    }

    return combineVisualizations(
      inputViz,
      convertSrjToGraphicsObject(this.getOutputSimpleRouteJson()),
    )
  }

  preview(): GraphicsObject {
    return this.visualize()
  }
}
