import { BaseSolver } from "@tscircuit/solver-utils"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import type {
  PreparedPipeline11Simplification,
  PreparedPipeline11Trace,
} from "./PrepareTraceSimplificationSolver"

type SimplifiedWireRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

export type ApplyTraceSimplificationSolverInput = {
  preparedInput: PreparedPipeline11Simplification
  simplifiedHdRoutes: HighDensityRoute[]
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

const restoreUniformWidth = (
  route: SimplifiedPcbTrace["route"],
  width: number,
): SimplifiedPcbTrace["route"] =>
  route.map((point) =>
    point.route_type === "wire" || point.route_type === "through_obstacle"
      ? { ...point, width }
      : point,
  )

/** Converts one simplified high-density route back to SRJ per step. */
export class ApplyTraceSimplificationSolver extends BaseSolver {
  private readonly simplifiedRouteByTraceId: Map<string, HighDensityRoute>
  private readonly outputTraces: SimplifiedPcbTrace[] = []
  private nextTraceIndex = 0

  constructor(
    public readonly inputProblem: ApplyTraceSimplificationSolverInput,
  ) {
    super()
    this.simplifiedRouteByTraceId = new Map(
      inputProblem.simplifiedHdRoutes.map((route) => [
        route.connectionName,
        route,
      ]),
    )
    this.MAX_ITERATIONS = inputProblem.preparedInput.preparedTraces.length + 1
  }

  override getSolverName(): string {
    return "ApplyTraceSimplificationSolver"
  }

  override _step(): void {
    const preparedTraces = this.inputProblem.preparedInput.preparedTraces
    const preparedTrace = preparedTraces[this.nextTraceIndex]
    if (!preparedTrace) {
      this.finishApplication()
      return
    }

    this.outputTraces.push(this.applyTrace(preparedTrace))
    this.nextTraceIndex++
    this.progress = this.nextTraceIndex / Math.max(1, preparedTraces.length)
  }

  private applyTrace(
    preparedTrace: PreparedPipeline11Trace,
  ): SimplifiedPcbTrace {
    if (!preparedTrace.mutableHdRoute) {
      return structuredClone(preparedTrace.originalTrace)
    }
    const simplifiedRoute = this.simplifiedRouteByTraceId.get(
      preparedTrace.originalTrace.pcb_trace_id,
    )
    if (!simplifiedRoute || preparedTrace.uniformTraceWidth === undefined) {
      throw new Error(
        `Simplification removed trace "${preparedTrace.originalTrace.pcb_trace_id}"`,
      )
    }

    const convertedRoute = convertHdRouteToSimplifiedRoute(
      simplifiedRoute,
      this.inputProblem.preparedInput.srj.layerCount,
      {
        defaultViaHoleDiameter: preparedTrace.viaHoleDiameter,
        obstacles: this.inputProblem.preparedInput.srj.obstacles,
        connMap: this.inputProblem.preparedInput.connMap,
      },
    )
    const jumpers = convertedRoute.filter(
      (point) => point.route_type === "jumper",
    )
    const route = restoreUniformWidth(
      [
        ...structuredClone(preparedTrace.leadingTerminalVias),
        ...convertedRoute.filter((point) => point.route_type !== "jumper"),
        ...structuredClone(preparedTrace.trailingTerminalVias),
        ...jumpers,
      ],
      preparedTrace.uniformTraceWidth,
    )
    restoreTerminalMetadata(route, simplifiedRoute)
    return { ...structuredClone(preparedTrace.originalTrace), route }
  }

  private finishApplication(): void {
    const preparedTraces = this.inputProblem.preparedInput.preparedTraces
    this.stats = {
      inputTraceCount: preparedTraces.length,
      outputTraceCount: this.outputTraces.length,
      inputRoutePointCount: preparedTraces.reduce(
        (count, trace) => count + trace.originalTrace.route.length,
        0,
      ),
      outputRoutePointCount: this.outputTraces.reduce(
        (count, trace) => count + trace.route.length,
        0,
      ),
    }
    this.progress = 1
    this.solved = true
  }

  override getConstructorParams(): readonly [
    ApplyTraceSimplificationSolverInput,
  ] {
    return [this.inputProblem] as const
  }

  override getOutput(): SimpleRouteJson {
    if (!this.solved) {
      throw new Error("Cannot get applied traces before conversion completes")
    }
    return {
      ...structuredClone(this.inputProblem.preparedInput.originalSrj),
      traces: structuredClone(this.outputTraces),
    }
  }
}
