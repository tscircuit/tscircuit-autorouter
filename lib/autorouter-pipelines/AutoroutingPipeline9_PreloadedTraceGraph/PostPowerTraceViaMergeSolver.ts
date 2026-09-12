import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { BaseSolver } from "../../solvers/BaseSolver"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "../AutoroutingPipeline11_Simplification/convertSimplifiedPcbTraceToHighDensityRoute"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"
import { getPipeline9NetByConnectionName } from "./getPipeline9NetByConnectionName"

export interface PostPowerTraceViaMergeSolverInput {
  inputSrj: SimpleRouteJson
  inputTraces: SimplifiedPcbTraces
  otherTraces: SimplifiedPcbTraces
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  viaDiameter: number
  viaHoleDiameter: number
}

type SimplifiedWireRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

const MIN_VIA_TO_VIA_CLEARANCE = 0.1

const getMaximumTraceWidth = (trace: SimplifiedPcbTrace): number => {
  const widths = trace.route.flatMap((point) =>
    point.route_type === "wire" || point.route_type === "through_obstacle"
      ? [point.width]
      : [],
  )
  if (widths.length === 0) {
    throw new Error(
      `Post-power trace "${trace.pcb_trace_id}" has no copper width`,
    )
  }
  return Math.max(...widths)
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

/** Enforces same-net via clearance after power expansion changes final copper. */
export class PostPowerTraceViaMergeSolver extends BaseSolver {
  private readonly merger: SameNetViaMergerSolver
  private readonly inputHdRouteByTraceId: ReadonlyMap<
    string,
    HighDensityRoute
  >
  private outputTraces?: SimplifiedPcbTraces

  constructor(public readonly inputProblem: PostPowerTraceViaMergeSolverInput) {
    super()
    const mutableTraces = inputProblem.inputTraces.filter((trace) =>
      trace.route.some((point) => point.route_type === "via"),
    )
    const inputHdRoutes = mutableTraces.map((trace) => {
      const maximumTraceWidth = getMaximumTraceWidth(trace)
      const route = convertSimplifiedPcbTraceToHighDensityRoute(trace, {
        layerCount: inputProblem.inputSrj.layerCount,
        defaultTraceThickness: maximumTraceWidth,
        defaultViaDiameter: inputProblem.viaDiameter,
        rootConnectionName:
          inputProblem.connMap.getNetConnectedToId(trace.connection_name) ??
          trace.connection_name,
      })
      route.traceThickness = maximumTraceWidth
      return route
    })
    this.inputHdRouteByTraceId = new Map(
      inputHdRoutes.map((route) => [route.connectionName, route]),
    )
    const immutableTraces = [
      ...inputProblem.inputTraces.filter((trace) =>
        trace.route.every((point) => point.route_type !== "via"),
      ),
      ...inputProblem.otherTraces,
    ]
    const otherHdRoutes = immutableTraces.flatMap(
      (trace, traceIndex) =>
        convertPreloadedTraceToHdRoutes(
          trace,
          traceIndex,
          inputProblem.inputSrj.layerCount,
          inputProblem.viaDiameter,
          inputProblem.connMap,
        ),
    )
    this.merger = new SameNetViaMergerSolver({
      inputHdRoutes,
      otherHdRoutes,
      netByConnectionName: getPipeline9NetByConnectionName(
        [...inputHdRoutes, ...otherHdRoutes],
        inputProblem.connMap,
      ),
      obstacles: inputProblem.inputSrj.obstacles,
      colorMap: inputProblem.colorMap,
      layerCount: inputProblem.inputSrj.layerCount,
      connMap: inputProblem.connMap,
      outline: inputProblem.inputSrj.outline,
      preserveRouteEndpoints: true,
      maximumViaCenterDistance:
        inputProblem.viaHoleDiameter + MIN_VIA_TO_VIA_CLEARANCE,
    })
    this.MAX_ITERATIONS = this.merger.MAX_ITERATIONS + 1
  }

  override getSolverName(): string {
    return "PostPowerTraceViaMergeSolver"
  }

  override _step(): void {
    this.merger.step()
    this.progress = this.merger.progress
    this.stats = this.merger.stats
    if (this.merger.failed) {
      this.error = this.merger.error
      this.failed = true
      return
    }
    if (!this.merger.solved) return

    const mergedRoutes = this.merger.getMergedViaHdRoutes()
    if (!mergedRoutes) {
      throw new Error("Same-net via merger solved without output routes")
    }
    const mutableTraceCount = this.inputProblem.inputTraces.filter((trace) =>
      trace.route.some((point) => point.route_type === "via"),
    ).length
    if (mergedRoutes.length !== mutableTraceCount) {
      throw new Error(
        "Same-net via merger changed the number of post-power traces with vias",
      )
    }
    const mergedRouteByTraceId = new Map(
      mergedRoutes.map((route) => [route.connectionName, route]),
    )
    this.outputTraces = this.inputProblem.inputTraces.map((trace) => {
      const mergedRoute = mergedRouteByTraceId.get(trace.pcb_trace_id)
      if (!mergedRoute) {
        if (trace.route.some((point) => point.route_type === "via")) {
          throw new Error(
            `Same-net via merger lost post-power trace "${trace.pcb_trace_id}"`,
          )
        }
        return structuredClone(trace)
      }
      const inputHdRoute = this.inputHdRouteByTraceId.get(trace.pcb_trace_id)
      if (!inputHdRoute) {
        throw new Error(
          `Post-power via merger cannot find input trace "${trace.pcb_trace_id}"`,
        )
      }
      if (
        JSON.stringify(inputHdRoute.route) ===
          JSON.stringify(mergedRoute.route) &&
        JSON.stringify(inputHdRoute.vias) === JSON.stringify(mergedRoute.vias)
      ) {
        return structuredClone(trace)
      }
      const route = convertHdRouteToSimplifiedRoute(
        mergedRoute,
        this.inputProblem.inputSrj.layerCount,
        {
          defaultViaHoleDiameter: this.inputProblem.viaHoleDiameter,
          obstacles: this.inputProblem.inputSrj.obstacles,
          connMap: this.inputProblem.connMap,
        },
      )
      restoreTerminalMetadata(route, mergedRoute)
      return { ...structuredClone(trace), route }
    })
    this.progress = 1
    this.solved = true
  }

  override getConstructorParams(): readonly [
    PostPowerTraceViaMergeSolverInput,
  ] {
    return [this.inputProblem] as const
  }

  getOutput(): SimplifiedPcbTraces {
    if (!this.solved || !this.outputTraces) {
      throw new Error("Cannot get post-power via merge output before solving")
    }
    return structuredClone(this.outputTraces)
  }

  override visualize(): GraphicsObject {
    return convertSrjToGraphicsObject({
      ...this.inputProblem.inputSrj,
      traces: this.solved ? this.getOutput() : this.inputProblem.inputTraces,
    })
  }
}
