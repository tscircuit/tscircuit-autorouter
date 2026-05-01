import {
  KiCadRoutingToolsAutorouter,
  type KiCadRoutingToolsAutorouterOptions,
} from "@tscircuit/krt-wasm"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  ConnectionPoint,
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { filterObstaclesOutsideBoard } from "lib/utils/filterObstaclesOutsideBoard"

export interface KrtAutoroutingPipelineSolverOptions {
  effort?: number
  krtOptions?: KiCadRoutingToolsAutorouterOptions
}

type KrtConnectionStitch = {
  connectionName: string
  from: Extract<ConnectionPoint, { layer: string }>
  to: Extract<ConnectionPoint, { layer: string }>
}

const getKrtClearance = (
  srj: SimpleRouteJson,
  opts: KrtAutoroutingPipelineSolverOptions,
) => opts.krtOptions?.clearance ?? srj.defaultObstacleMargin ?? 0.2

const isSingleLayerPoint = (
  point: ConnectionPoint,
): point is Extract<ConnectionPoint, { layer: string }> =>
  typeof (point as { layer?: unknown }).layer === "string"

const distanceBetweenPoints = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => Math.hypot(a.x - b.x, a.y - b.y)

const normalizeSrjForKrt = (
  srj: SimpleRouteJson,
  clearance: number,
): { srj: SimpleRouteJson; stitches: KrtConnectionStitch[] } => {
  const closePointThreshold = srj.minTraceWidth + clearance
  const stitches: KrtConnectionStitch[] = []

  const connections = srj.connections.map((connection) => {
    const pointsToConnect: ConnectionPoint[] = []

    for (const point of connection.pointsToConnect) {
      const closePoint =
        isSingleLayerPoint(point) &&
        pointsToConnect.find(
          (
            candidate,
          ): candidate is Extract<ConnectionPoint, { layer: string }> =>
            isSingleLayerPoint(candidate) &&
            candidate.layer === point.layer &&
            distanceBetweenPoints(candidate, point) <= closePointThreshold,
        )

      if (closePoint) {
        stitches.push({
          connectionName: connection.name,
          from: point,
          to: closePoint,
        })
      } else {
        pointsToConnect.push(point)
      }
    }

    return {
      ...connection,
      pointsToConnect,
    }
  })

  return {
    srj: {
      ...srj,
      connections,
      obstacles: srj.obstacles.map((obstacle) =>
        (obstacle as { type: string }).type === "oval"
          ? {
              ...obstacle,
              type: "rect",
            }
          : obstacle,
      ),
    },
    stitches,
  }
}

const toWirePoint = (
  point: Extract<ConnectionPoint, { layer: string }>,
  width: number,
): SimplifiedPcbTrace["route"][number] => ({
  route_type: "wire",
  x: point.x,
  y: point.y,
  layer: point.layer,
  width,
})

const addStitchesToTraces = (
  traces: SimplifiedPcbTraces,
  stitches: KrtConnectionStitch[],
  width: number,
): SimplifiedPcbTraces => {
  if (stitches.length === 0) return traces

  const tracesWithStitches = structuredClone(traces)

  for (const stitch of stitches) {
    const trace = tracesWithStitches.find(
      (candidate) => candidate.connection_name === stitch.connectionName,
    )
    if (!trace) continue

    const firstRoutePoint = trace.route.find(
      (point) => "x" in point && "y" in point,
    )
    const lastRoutePoint = [...trace.route]
      .reverse()
      .find((point) => "x" in point && "y" in point)

    const stitchRoute = [
      toWirePoint(stitch.from, width),
      toWirePoint(stitch.to, width),
    ]

    if (
      firstRoutePoint &&
      (!lastRoutePoint ||
        distanceBetweenPoints(stitch.to, firstRoutePoint) <=
          distanceBetweenPoints(stitch.to, lastRoutePoint))
    ) {
      trace.route.unshift(...stitchRoute)
    } else {
      trace.route.push(...stitchRoute.reverse())
    }
  }

  return tracesWithStitches
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
    const clearance = getKrtClearance(this.srj, this.opts)
    const normalized = normalizeSrjForKrt(this.srj, clearance)
    this.router = new KiCadRoutingToolsAutorouter(normalized.srj as any, {
      clearance,
      maxIterations: Math.max(300_000, Math.round(300_000 * effort)),
      ...this.opts.krtOptions,
    })
    this.traces = addStitchesToTraces(
      this.router.solveSync() as SimplifiedPcbTraces,
      normalized.stitches,
      this.srj.minTraceWidth,
    )
    this.stats.traceCount = this.traces.length
    this.stats.stitchCount = normalized.stitches.length
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
