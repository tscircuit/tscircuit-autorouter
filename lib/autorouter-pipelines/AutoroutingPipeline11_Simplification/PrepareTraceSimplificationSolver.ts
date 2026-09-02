import { BaseSolver } from "@tscircuit/solver-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { getColorMap } from "lib/solvers/colors"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import type { AutoroutingPipelineSolver11SimplificationOptions } from "./AutoroutingPipelineSolver11_Simplification"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "./convertSimplifiedPcbTraceToHighDensityRoute"

const WIDTH_TOLERANCE = 1e-9

export type PreparedPipeline11Trace = {
  originalTrace: SimplifiedPcbTrace
  mutableHdRoute?: HighDensityRoute
  leadingTerminalVias: SimplifiedPcbTrace["route"]
  trailingTerminalVias: SimplifiedPcbTrace["route"]
  uniformTraceWidth?: number
  viaHoleDiameter: number
}

export type PreparedPipeline11Simplification = {
  originalSrj: SimpleRouteJson
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  immutableHdRoutes: HighDensityRoute[]
  mutableHdRoutes: HighDensityRoute[]
  netByConnectionName: Map<string, string>
  options: AutoroutingPipelineSolver11SimplificationOptions
  preparedTraces: PreparedPipeline11Trace[]
}

export type PrepareTraceSimplificationSolverInput = {
  inputSrj: SimpleRouteJson
  options: AutoroutingPipelineSolver11SimplificationOptions
}

const splitTerminalVias = (
  trace: SimplifiedPcbTrace,
): {
  traceToSimplify: SimplifiedPcbTrace
  leadingTerminalVias: SimplifiedPcbTrace["route"]
  trailingTerminalVias: SimplifiedPcbTrace["route"]
} => {
  let leadingViaCount = 0
  while (trace.route[leadingViaCount]?.route_type === "via") {
    leadingViaCount++
  }

  let trailingViaEnd = trace.route.length
  while (trace.route[trailingViaEnd - 1]?.route_type === "jumper") {
    trailingViaEnd--
  }
  let trailingViaStart = trailingViaEnd
  while (
    trailingViaStart > leadingViaCount &&
    trace.route[trailingViaStart - 1]?.route_type === "via"
  ) {
    trailingViaStart--
  }

  return {
    traceToSimplify: {
      ...trace,
      route: [
        ...trace.route.slice(leadingViaCount, trailingViaStart),
        ...trace.route.slice(trailingViaEnd),
      ],
    },
    leadingTerminalVias: trace.route.slice(0, leadingViaCount),
    trailingTerminalVias: trace.route.slice(trailingViaStart, trailingViaEnd),
  }
}

const getUniformTraceWidth = (
  trace: SimplifiedPcbTrace,
): number | undefined => {
  const widths = trace.route.flatMap((point) =>
    point.route_type === "wire" || point.route_type === "through_obstacle"
      ? [point.width]
      : [],
  )
  const firstWidth = widths[0]
  if (
    firstWidth === undefined ||
    widths.some((width) => Math.abs(width - firstWidth) > WIDTH_TOLERANCE)
  ) {
    return undefined
  }
  return firstWidth
}

const getViaHoleDiameter = (
  trace: SimplifiedPcbTrace,
  defaultViaHoleDiameter: number,
): number => {
  for (const point of trace.route) {
    if (point.route_type === "via" && point.via_hole_diameter !== undefined) {
      return point.via_hole_diameter
    }
  }
  return defaultViaHoleDiameter
}

export class PrepareTraceSimplificationSolver extends BaseSolver {
  private readonly preparedInput: PreparedPipeline11Simplification
  private readonly seenTraceIds = new Set<string>()
  private nextTraceIndex = 0

  constructor(input: PrepareTraceSimplificationSolverInput) {
    super()
    const originalSrj = structuredClone(input.inputSrj)
    const srj = createSrjWithBoardValidObstacleLayers(originalSrj)
    const connMap = getConnectivityMapFromSimpleRouteJson(srj)
    this.preparedInput = {
      originalSrj,
      srj,
      connMap,
      colorMap: getColorMap(srj, connMap),
      immutableHdRoutes: [],
      mutableHdRoutes: [],
      netByConnectionName: new Map(),
      options: { ...input.options },
      preparedTraces: [],
    }
    this.MAX_ITERATIONS = (srj.traces?.length ?? 0) + 1
  }

  override getSolverName(): string {
    return "PrepareTraceSimplificationSolver"
  }

  override _step(): void {
    const traces = this.preparedInput.srj.traces ?? []
    const trace = traces[this.nextTraceIndex]
    if (!trace) {
      this.stats = {
        inputTraceCount: traces.length,
        mutableTraceCount: this.preparedInput.mutableHdRoutes.length,
        immutableTraceCount:
          traces.length - this.preparedInput.mutableHdRoutes.length,
      }
      this.progress = 1
      this.solved = true
      return
    }

    this.prepareTrace(trace, this.nextTraceIndex)
    this.nextTraceIndex++
    this.progress = this.nextTraceIndex / Math.max(1, traces.length)
  }

  private prepareTrace(trace: SimplifiedPcbTrace, traceIndex: number): void {
    if (this.seenTraceIds.has(trace.pcb_trace_id)) {
      throw new Error(`Duplicate pcb_trace_id "${trace.pcb_trace_id}"`)
    }
    this.seenTraceIds.add(trace.pcb_trace_id)
    const viaDimensions = getViaDimensions(this.preparedInput.srj)
    const uniformTraceWidth = getUniformTraceWidth(trace)
    const { traceToSimplify, leadingTerminalVias, trailingTerminalVias } =
      splitTerminalVias(trace)
    const rootConnectionName =
      this.preparedInput.connMap.getNetConnectedToId(trace.connection_name) ??
      trace.connection_name
    const mutableHdRoute =
      uniformTraceWidth === undefined
        ? undefined
        : convertSimplifiedPcbTraceToHighDensityRoute(traceToSimplify, {
            layerCount: this.preparedInput.srj.layerCount,
            defaultTraceThickness: uniformTraceWidth,
            defaultViaDiameter: viaDimensions.padDiameter,
            rootConnectionName,
          })
    const usableMutableHdRoute =
      mutableHdRoute && mutableHdRoute.route.length >= 2
        ? mutableHdRoute
        : undefined

    this.preparedInput.preparedTraces.push({
      originalTrace: trace,
      mutableHdRoute: usableMutableHdRoute,
      leadingTerminalVias,
      trailingTerminalVias,
      uniformTraceWidth,
      viaHoleDiameter: getViaHoleDiameter(trace, viaDimensions.holeDiameter),
    })

    if (!usableMutableHdRoute) {
      this.preparedInput.immutableHdRoutes.push(
        ...convertPreloadedTraceToHdRoutes(
          trace,
          traceIndex,
          this.preparedInput.srj.layerCount,
          viaDimensions.padDiameter,
          this.preparedInput.connMap,
        ),
      )
      return
    }

    this.preparedInput.mutableHdRoutes.push(usableMutableHdRoute)
    this.preparedInput.netByConnectionName.set(
      usableMutableHdRoute.connectionName,
      rootConnectionName,
    )
    this.preparedInput.colorMap[usableMutableHdRoute.connectionName] =
      this.preparedInput.colorMap[rootConnectionName] ??
      this.preparedInput.colorMap[trace.connection_name] ??
      "#2563eb"

    const terminalViaRoute = {
      ...trace,
      route: [...leadingTerminalVias, ...trailingTerminalVias],
    }
    this.preparedInput.immutableHdRoutes.push(
      ...convertPreloadedTraceToHdRoutes(
        terminalViaRoute,
        traceIndex,
        this.preparedInput.srj.layerCount,
        viaDimensions.padDiameter,
        this.preparedInput.connMap,
      ),
    )
  }

  override getOutput(): PreparedPipeline11Simplification {
    if (!this.solved) {
      throw new Error("Cannot get prepared traces before preparation completes")
    }
    return this.preparedInput
  }
}
