import { applyBroadRepulsionForces } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "../AutoroutingPipeline11_Simplification/convertSimplifiedPcbTraceToHighDensityRoute"
import {
  hasNoNewOrWorseCopperErrors,
  hasNoWorseTraceGapGeometry,
} from "./hasNoNewOrWorseCopperErrors"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

type Params = {
  originalSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  traces: readonly SimplifiedPcbTrace[]
  effort: number
}

/** Select independent, reference-validated force repairs on final copper. */
export class Pipeline9FinalCopperRepairSolver extends BaseSolver {
  private output: SimplifiedPcbTrace[]
  private readonly originalTraceIds: Set<string>
  private errors: Pipeline9DrcError[]
  private readonly initialCount: number
  private initialRoutes: HighDensityRoute[] = []
  private currentRoutes: HighDensityRoute[] = []
  private proposedRoutes?: HighDensityRoute[]
  private readonly connMap?: ReturnType<typeof getConnectivityMapFromSimpleRouteJson>
  private queue: number[] = []
  private searched = 0
  private accepted = 0

  constructor(public readonly params: Params) {
    super()
    this.output = [...params.traces]
    this.originalTraceIds = new Set(
      params.originalSrj.traces?.map((trace) => trace.pcb_trace_id),
    )
    this.errors = this.evaluate(this.output)
    this.initialCount = this.errors.length
    if (this.errors.length === 0 || params.effort <= 0) {
      this.solved = true
      this.updateStats()
      return
    }
    const srj = params.originalSrj
    const connMap = getConnectivityMapFromSimpleRouteJson({
      ...srj,
      connections: [...srj.connections, ...params.srjWithPointPairs.connections],
      traces: this.output,
    })
    this.connMap = connMap
    this.initialRoutes = params.traces.map((trace) =>
      convertSimplifiedPcbTraceToHighDensityRoute(trace, {
        layerCount: srj.layerCount,
        defaultTraceThickness: srj.minTraceWidth,
        defaultViaDiameter: srj.minViaDiameter ?? 0.3,
        rootConnectionName:
          connMap.getNetConnectedToId(trace.connection_name) ??
          trace.connection_name,
      }),
    )
    this.currentRoutes = this.initialRoutes
    const affected = new Set(this.errors.flatMap(getDrcErrorTraceIds))
    const protectedNames = [
      ...(srj.differentialPairs ?? []).flatMap((pair) => pair.connectionNames),
      ...(srj.buses ?? []).flatMap((bus) => bus.connectionNames),
    ]
    for (let i = 0; i < params.traces.length; i++) {
      const trace = params.traces[i]!
      if (
        affected.has(trace.pcb_trace_id) &&
        !trace.route.some((point) =>
          point.route_type === "through_obstacle" ||
          point.route_type === "jumper",
        ) &&
        !protectedNames.some((name) =>
          connMap.areIdsConnected(trace.pcb_trace_id, name),
        )
      ) {
        this.queue.push(i)
      }
    }
    this.queue = this.queue.slice(0, Math.min(64, Math.ceil(params.effort * 32)))
    if (this.queue.length === 0) this.solved = true
    this.MAX_ITERATIONS = this.queue.length + 3
    this.updateStats()
  }

  private evaluate(traces: SimplifiedPcbTrace[]): Pipeline9DrcError[] {
    return evaluateRelaxedDrc({
      inputSrj: this.params.originalSrj,
      srjWithPointPairs: this.params.srjWithPointPairs,
      includeBoardClearance: true,
      drcOptions: {
        traceClearance: Math.max(
          0.1,
          this.params.originalSrj.minTraceToPadEdgeClearance ?? 0.1,
        ),
        viaClearance: Math.max(
          0.1,
          this.params.originalSrj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
        ),
      },
      routedTraces: traces.map((trace) =>
        this.originalTraceIds.has(trace.pcb_trace_id)
          ? { ...trace, __replaces_pcb_trace_id: trace.pcb_trace_id }
          : trace,
      ),
    }).errors as unknown as Pipeline9DrcError[]
  }

  private materialize(candidate: HighDensityRoute[]): SimplifiedPcbTrace[] {
    return this.params.traces.map((trace, ri) => {
      const original = this.initialRoutes[ri]!
      const changed = candidate[ri]!
      if (changed === original) return trace
      const route = trace.route.map((point) => {
        if (point.route_type === "wire") {
          const index = original.route.findIndex((old) =>
            Math.abs(old.x - point.x) < 1e-8 &&
            Math.abs(old.y - point.y) < 1e-8 &&
            old.z ===
              mapLayerNameToZ(point.layer, this.params.originalSrj.layerCount),
          )
          if (index < 0) {
            throw new Error(`Missing wire vertex in ${trace.pcb_trace_id}`)
          }
          const moved = changed.route[index]!
          return { ...point, x: moved.x, y: moved.y }
        }
        if (point.route_type === "via") {
          const index = original.vias.findIndex((old) =>
            Math.abs(old.x - point.x) < 1e-8 && Math.abs(old.y - point.y) < 1e-8,
          )
          if (index < 0) throw new Error(`Missing via in ${trace.pcb_trace_id}`)
          return { ...point, ...changed.vias[index]! }
        }
        return point
      })
      return {
        ...trace,
        route,
        ...(this.originalTraceIds.has(trace.pcb_trace_id)
          ? { __replaces_pcb_trace_id: trace.pcb_trace_id }
          : {}),
      }
    })
  }

  override _step(): void {
    if (!this.proposedRoutes) {
      const srj = this.params.originalSrj
      const connMap = this.connMap
      if (!connMap) throw new Error("Final copper repair is missing connectivity")
      this.proposedRoutes = applyBroadRepulsionForces(
        {
        ...srj,
        traces: undefined,
        minTraceToPadEdgeClearance: Math.max(
          0.1,
          srj.minTraceToPadEdgeClearance ?? 0.1,
        ),
        },
        this.initialRoutes,
        Math.min(1, this.params.effort),
        1,
        connMap,
      )
      return
    }
    const index = this.queue.shift()
    if (index === undefined || this.errors.length === 0) {
      this.solved = true
      this.updateStats()
      return
    }
    const proposed = this.proposedRoutes[index]!
    const original = this.initialRoutes[index]!
    // This search preserves topology, layers and every copper dimension.
    if (
      proposed.route.length !== original.route.length ||
      proposed.vias.length !== original.vias.length ||
      proposed.route.some((point, i) => {
        const old = original.route[i]!
        const locked = i === 0 || i === original.route.length - 1 || old.pcb_port_id
        return (
          point.z !== old.z ||
          point.traceThickness !== old.traceThickness ||
          (locked && (point.x !== old.x || point.y !== old.y))
        )
      })
    ) return
    const candidate = this.currentRoutes.map((route, i) =>
      i === index ? proposed : route,
    )
    const traces = this.materialize(candidate)
    const errors = this.evaluate(traces)
    this.searched++
    if (
      errors.length < this.errors.length &&
      hasNoNewOrWorseCopperErrors(this.errors, errors) &&
      hasNoWorseTraceGapGeometry(this.currentRoutes, candidate, errors)
    ) {
      this.currentRoutes = candidate
      this.output = traces
      this.errors = errors
      this.accepted++
    }
    this.updateStats()
  }

  private updateStats(): void {
    this.stats = {
      finalCopperInitialDrcIssueCount: this.initialCount,
      finalCopperFinalDrcIssueCount: this.errors.length,
      finalCopperCandidateCount: this.searched,
      finalCopperAcceptedCount: this.accepted,
    }
  }

  getOutput(): SimplifiedPcbTrace[] {
    if (!this.solved) {
      throw new Error("Final copper repair output requested before completion")
    }
    return this.output
  }

  getRoutedTraces(): SimplifiedPcbTrace[] {
    return this.getOutput().filter((trace) =>
      !this.originalTraceIds.has(trace.pcb_trace_id) ||
      trace.__replaces_pcb_trace_id !== undefined,
    )
  }
}
