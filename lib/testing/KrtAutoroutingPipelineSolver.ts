import type { KiCadRoutingToolsAutorouterOptions } from "@tscircuit/krt-wasm"
import { routeSimpleRouteJson } from "@tscircuit/krt-wasm/pkg-node/grid_router.js"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { acceptKrtBranches } from "./acceptKrtBranches"
import { prepareKrtBranches } from "./prepareKrtBranches"

export interface KrtAutoroutingPipelineSolverOptions {
  effort?: number
  krtOptions?: KiCadRoutingToolsAutorouterOptions
}

class KrtAutorouterSolver extends BaseSolver {
  MAX_ITERATIONS = 1
  traces: SimplifiedPcbTraces = []

  constructor(
    public readonly srj: SimpleRouteJson,
    public readonly opts: KrtAutoroutingPipelineSolverOptions = {},
  ) {
    super()
  }

  getConstructorParams(): readonly [
    SimpleRouteJson,
    KrtAutoroutingPipelineSolverOptions,
  ] {
    return [this.srj, this.opts]
  }

  _step(): void {
    const preparationStarted = performance.now()
    const prepared = prepareKrtBranches(this.srj)
    const options = this.opts.krtOptions ?? {}
    const gridStep = options.gridStep ?? 0.1
    if (!Number.isFinite(gridStep) || gridStep <= 0) {
      throw new Error("KRT gridStep must be finite and positive")
    }
    const clearance = Math.max(
      options.clearance ?? 0.2,
      this.srj.defaultObstacleMargin ?? 0,
      this.srj.minTraceToHoleEdgeClearance ?? 0,
    )
    const requestedWidth = Math.max(
      this.srj.minTraceWidth,
      ...prepared.srj.connections.map(
        (connection) => connection.nominalTraceWidth ?? this.srj.minTraceWidth,
      ),
    )
    const edgeInset =
      Math.max(requestedWidth, getViaDimensions(this.srj).padDiameter) / 2 +
      (this.srj.minBoardEdgeClearance ?? 0) +
      gridStep / 2
    const xs = this.srj.outline?.map((point) => point.x)
    const ys = this.srj.outline?.map((point) => point.y)
    const bounds = {
      minX:
        Math.max(
          this.srj.bounds.minX,
          xs?.length ? Math.min(...xs) : this.srj.bounds.minX,
        ) + edgeInset,
      maxX:
        Math.min(
          this.srj.bounds.maxX,
          xs?.length ? Math.max(...xs) : this.srj.bounds.maxX,
        ) - edgeInset,
      minY:
        Math.max(
          this.srj.bounds.minY,
          ys?.length ? Math.min(...ys) : this.srj.bounds.minY,
        ) + edgeInset,
      maxY:
        Math.min(
          this.srj.bounds.maxY,
          ys?.length ? Math.max(...ys) : this.srj.bounds.maxY,
        ) - edgeInset,
    }
    if (bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) {
      throw new Error(
        "KRT has no routing bounds after original edge constraints",
      )
    }
    this.stats.preparationMs = performance.now() - preparationStarted
    this.stats.gridStep = gridStep
    this.stats.branchCount = prepared.branches.length
    const routingStarted = performance.now()
    let proposed: unknown
    try {
      proposed = routeSimpleRouteJson(
        { ...prepared.srj, bounds },
        {
          ...options,
          gridStep,
          clearance,
          maxIterations:
            options.maxIterations ??
            Math.max(300_000, Math.round(300_000 * (this.opts.effort ?? 1))),
        },
      )
    } finally {
      this.stats.routingMs = performance.now() - routingStarted
    }
    const acceptanceStarted = performance.now()
    try {
      this.traces = acceptKrtBranches({
        original: this.srj,
        branches: prepared.branches,
        proposed,
        gridStep,
      })
    } finally {
      this.stats.acceptanceMs = performance.now() - acceptanceStarted
    }
    this.stats.traceCount = this.traces.length
    this.solved = true
  }

  visualize(): GraphicsObject {
    return convertSrjToGraphicsObject({ ...this.srj, traces: this.traces })
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
    this.srj = structuredClone(inputSrj)
  }

  srj: SimpleRouteJson

  getConstructorParams(): readonly [
    SimpleRouteJson,
    KrtAutoroutingPipelineSolverOptions,
  ] {
    return [this.inputSrj, this.opts] as const
  }

  _step(): void {
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
    const solver = new pipelineStepDef.solverClass(...constructorParams)
    this.activeSubSolver = solver
    this.krtAutorouterSolver = solver
    this.timeSpentOnPhase[pipelineStepDef.solverName] = 0
    this.startTimeOfPhase[pipelineStepDef.solverName] = performance.now()
  }

  solveUntilPhase(phase: string): void {
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
      ...structuredClone(this.srj),
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

    return convertSrjToGraphicsObject(this.getOutputSimpleRouteJson())
  }

  preview(): GraphicsObject {
    return this.visualize()
  }
}
