import type { GraphicsObject } from "graphics-debug"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getColorMap } from "lib/solvers/colors"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "./convertSimplifiedPcbTraceToHighDensityRoute"

export interface SimplificationPipelineSolverOptions {
  /** Number of complete cleanup passes. Defaults to two. */
  iterations?: number
  /** Enables coordinated layer swaps that reduce vias at crossings. */
  enableCrossingViaReduction?: boolean
}

type PreparedTrace = {
  originalTrace: SimplifiedPcbTrace
  hdRoute?: HighDensityRoute
  viaHoleDiameter: number
  leadingTerminalVias: SimplifiedPcbTrace["route"]
  trailingTerminalVias: SimplifiedPcbTrace["route"]
}

type SimplifiedWireRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

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

const restoreTerminalMetadata = (
  route: SimplifiedPcbTrace["route"],
  hdRoute: HighDensityRoute,
): void => {
  const wirePoints = route.filter(
    (point): point is SimplifiedWireRoutePoint => point.route_type === "wire",
  )
  if (hdRoute.startPcbPortId && wirePoints[0]) {
    wirePoints[0].start_pcb_port_id = hdRoute.startPcbPortId
  }
  if (hdRoute.endPcbPortId && wirePoints.at(-1)) {
    wirePoints.at(-1)!.end_pcb_port_id = hdRoute.endPcbPortId
  }
}

/**
 * Runs only post-route trace cleanup. Unlike an autorouting pipeline, it does
 * not create routes for SRJ connections; it simplifies the traces already
 * present on the input SimpleRouteJson.
 */
export class SimplificationPipelineSolver extends BaseSolver {
  override getSolverName(): string {
    return "SimplificationPipelineSolver"
  }

  readonly originalSrj: SimpleRouteJson
  readonly srj: SimpleRouteJson
  readonly opts: SimplificationPipelineSolverOptions
  private readonly connMap: ConnectivityMap
  traceSimplificationSolver?: TraceSimplificationSolver
  private readonly preparedTraces: PreparedTrace[]
  private outputTraces?: SimplifiedPcbTraces

  constructor(
    srj: SimpleRouteJson,
    opts: SimplificationPipelineSolverOptions = {},
  ) {
    super()
    if (
      opts.iterations !== undefined &&
      (!Number.isInteger(opts.iterations) || opts.iterations < 1)
    ) {
      throw new Error("Simplification iterations must be a positive integer")
    }

    this.originalSrj = srj
    this.srj = createSrjWithBoardValidObstacleLayers(srj)
    this.opts = { ...opts }
    this.MAX_ITERATIONS = 100e6

    this.connMap = getConnectivityMapFromSimpleRouteJson(this.srj)
    const viaDimensions = getViaDimensions(this.srj)
    const seenTraceIds = new Set<string>()
    this.preparedTraces = (this.srj.traces ?? []).map((trace) => {
      if (seenTraceIds.has(trace.pcb_trace_id)) {
        throw new Error(`Duplicate pcb_trace_id "${trace.pcb_trace_id}"`)
      }
      seenTraceIds.add(trace.pcb_trace_id)
      const rootConnectionName =
        this.connMap.getNetConnectedToId(trace.connection_name) ??
        trace.connection_name
      const { traceToSimplify, leadingTerminalVias, trailingTerminalVias } =
        splitTerminalVias(trace)
      const hdRoute = convertSimplifiedPcbTraceToHighDensityRoute(
        traceToSimplify,
        {
          layerCount: this.srj.layerCount,
          defaultTraceThickness: this.srj.minTraceWidth,
          defaultViaDiameter: viaDimensions.padDiameter,
          rootConnectionName,
        },
      )
      return {
        originalTrace: trace,
        hdRoute: hdRoute.route.length >= 2 ? hdRoute : undefined,
        viaHoleDiameter: getViaHoleDiameter(trace, viaDimensions.holeDiameter),
        leadingTerminalVias,
        trailingTerminalVias,
      }
    })
  }

  override getConstructorParams(): readonly [
    SimpleRouteJson,
    SimplificationPipelineSolverOptions,
  ] {
    return [this.originalSrj, this.opts]
  }

  override _step(): void {
    if (!this.traceSimplificationSolver) {
      const hdRoutes = this.preparedTraces.flatMap((preparedTrace) =>
        preparedTrace.hdRoute ? [preparedTrace.hdRoute] : [],
      )
      if (hdRoutes.length === 0) {
        this.outputTraces = structuredClone(this.srj.traces ?? [])
        this.solved = true
        this.progress = 1
        return
      }

      const colorMap = getColorMap(this.srj, this.connMap)
      const netByConnectionName = new Map<string, string>()
      for (const route of hdRoutes) {
        netByConnectionName.set(
          route.connectionName,
          route.rootConnectionName ?? route.connectionName,
        )
        colorMap[route.connectionName] =
          colorMap[route.rootConnectionName ?? ""] ??
          colorMap[route.connectionName] ??
          "#2563eb"
      }

      const viaDimensions = getViaDimensions(this.srj)
      this.traceSimplificationSolver = new TraceSimplificationSolver({
        hdRoutes,
        obstacles: this.srj.obstacles,
        connMap: this.connMap,
        colorMap,
        outline: this.srj.outline,
        defaultViaDiameter: viaDimensions.padDiameter,
        layerCount: this.srj.layerCount,
        minTraceToPadEdgeClearance: this.srj.minTraceToPadEdgeClearance,
        minBoardEdgeClearance: this.srj.minBoardEdgeClearance,
        netByConnectionName,
        enableCrossingViaReduction:
          this.opts.enableCrossingViaReduction ?? true,
        preserveRouteEndpoints: true,
      })
      this.traceSimplificationSolver.MAX_SIMPLIFICATION_PIPELINE_LOOPS =
        this.opts.iterations ?? 2
      this.activeSubSolver = this.traceSimplificationSolver
      return
    }

    this.traceSimplificationSolver.step()
    this.progress = this.traceSimplificationSolver.progress
    if (this.traceSimplificationSolver.failed) {
      this.error = this.traceSimplificationSolver.error
      this.failed = true
      this.activeSubSolver = null
      return
    }
    if (!this.traceSimplificationSolver.solved) return

    const simplifiedRouteByTraceId = new Map(
      this.traceSimplificationSolver.simplifiedHdRoutes.map((route) => [
        route.connectionName,
        route,
      ]),
    )
    this.outputTraces = this.preparedTraces.map((preparedTrace) => {
      if (!preparedTrace.hdRoute) {
        return structuredClone(preparedTrace.originalTrace)
      }
      const simplifiedRoute = simplifiedRouteByTraceId.get(
        preparedTrace.originalTrace.pcb_trace_id,
      )
      if (!simplifiedRoute) {
        throw new Error(
          `Simplification removed trace "${preparedTrace.originalTrace.pcb_trace_id}"`,
        )
      }
      const simplifiedPcbRoute = convertHdRouteToSimplifiedRoute(
        simplifiedRoute,
        this.srj.layerCount,
        {
          defaultViaHoleDiameter: preparedTrace.viaHoleDiameter,
          obstacles: this.srj.obstacles,
          connMap: this.connMap,
        },
      )
      const jumpers = simplifiedPcbRoute.filter(
        (point) => point.route_type === "jumper",
      )
        const route = [
          ...structuredClone(preparedTrace.leadingTerminalVias),
          ...simplifiedPcbRoute.filter((point) => point.route_type !== "jumper"),
          ...structuredClone(preparedTrace.trailingTerminalVias),
        ...jumpers,
      ]
      restoreTerminalMetadata(route, simplifiedRoute)
      return {
        ...preparedTrace.originalTrace,
        route,
      }
    })
    this.stats = {
      inputTraceCount: this.preparedTraces.length,
      outputTraceCount: this.outputTraces.length,
      inputRoutePointCount: this.preparedTraces.reduce(
        (count, trace) => count + trace.originalTrace.route.length,
        0,
      ),
      outputRoutePointCount: this.outputTraces.reduce(
        (count, trace) => count + trace.route.length,
        0,
      ),
    }
    this.activeSubSolver = null
    this.solved = true
    this.progress = 1
  }

  getCurrentPhase(): string {
    return this.solved ? "none" : "traceSimplificationSolver"
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    if (!this.solved || !this.outputTraces) {
      throw new Error("Cannot get output before simplification is complete")
    }
    return structuredClone(this.outputTraces)
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return {
      ...this.originalSrj,
      traces: this.getOutputSimplifiedPcbTraces(),
    }
  }

  override visualize(): GraphicsObject {
    return this.traceSimplificationSolver?.visualize() ?? super.visualize()
  }

  override preview(): GraphicsObject {
    return this.traceSimplificationSolver?.preview() ?? super.preview()
  }
}
