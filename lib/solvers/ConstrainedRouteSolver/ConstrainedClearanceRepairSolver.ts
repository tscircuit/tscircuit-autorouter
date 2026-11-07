import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { RelaxTraceClearanceSolver } from "@tscircuit/repair04"
import { convertSimplifiedPcbTraceToHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/convertSimplifiedPcbTraceToHighDensityRoute"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { BaseSolver } from "../BaseSolver"

type ErrorRecord = Record<string, unknown>
type Evaluation = ReturnType<
  ReturnType<typeof createPipeline9AutoroutingDrcEvaluator>
>
type Via = Extract<SimplifiedPcbTrace["route"][number], { route_type: "via" }>
const OFFSETS = [0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8].flatMap((radius) =>
  Array.from({ length: 16 }, (_, angle) => ({
    x: radius * Math.cos((Math.PI * angle) / 8),
    y: radius * Math.sin((Math.PI * angle) / 8),
  })),
)

/** Finish constrained routing without allowing clearance repair to move its paths. */
export class ConstrainedClearanceRepairSolver extends BaseSolver {
  traces: SimplifiedPcbTrace[]
  private readonly original: SimplifiedPcbTrace[]
  private readonly evaluate: ReturnType<
    typeof createPipeline9AutoroutingDrcEvaluator
  >
  private readonly connectivity: ReturnType<
    typeof getConnectivityMapFromSimpleRouteJson
  >
  private readonly locked = new Set<string>()
  private readonly terminals = new Set<string>()
  private result: Evaluation
  private phase: "relax" | "select" | "vias" = "relax"
  private relaxation?: RelaxTraceClearanceSolver
  private hdInput?: ReturnType<
    typeof convertSimplifiedPcbTraceToHighDensityRoute
  >[]
  private pending: Array<{ traceId: string; via: Via }> = []
  private pass = 0
  private passImproved = false
  private candidateIndex = 0
  private best?: {
    traces: SimplifiedPcbTrace[]
    result: Evaluation
    score: number
  }

  constructor(
    private readonly srj: SimpleRouteJson,
    traces: SimplifiedPcbTrace[],
  ) {
    super()
    this.traces = traces
    this.original = traces
    this.connectivity = getConnectivityMapFromSimpleRouteJson({
      ...srj,
      traces,
    })
    const constrainedNets = new Set(
      (srj.routeConstraints ?? []).map((rule) =>
        this.connectivity.getNetConnectedToId(rule.connectionName),
      ),
    )
    const preloadedIds = new Set(
      (srj.traces ?? []).map((trace) => trace.pcb_trace_id),
    )
    for (const trace of traces) {
      if (
        preloadedIds.has(trace.pcb_trace_id) ||
        constrainedNets.has(
          this.connectivity.getNetConnectedToId(trace.connection_name),
        ) ||
        trace.route.some(
          (point) => point.route_type !== "wire" && point.route_type !== "via",
        )
      )
        this.locked.add(trace.pcb_trace_id)
    }
    for (const connection of srj.connections)
      for (const point of connection.pointsToConnect)
        this.terminals.add(`${point.x.toFixed(7)},${point.y.toFixed(7)}`)
    this.evaluate = createPipeline9AutoroutingDrcEvaluator({
      inputSrj: { ...srj, traces: [] },
      srjWithPointPairs: srj,
      includeBoardClearance: true,
      drcOptions: {
        traceClearance:
          srj.minTraceToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0.1,
      },
    })
    this.result = this.evaluate(traces)
    this.MAX_ITERATIONS =
      10_000 +
      traces.reduce(
        (count, trace) =>
          count +
          trace.route.filter((point) => point.route_type === "via").length,
        0,
      ) *
        8 *
        (OFFSETS.length + 2)
    if (this.result.errors.length === 0) this.solved = true
  }

  private errorKey(error: ErrorRecord): string {
    const id =
      error.pcb_trace_error_id ??
      error.pcb_pad_trace_clearance_error_id ??
      error.pcb_via_trace_clearance_error_id ??
      error.pcb_pad_pad_clearance_error_id ??
      error.pcb_via_clearance_error_id ??
      error.pcb_error_id
    if (typeof id === "string") return `${error.type}:${id}`
    return JSON.stringify(error)
  }

  private score(errors: ErrorRecord[]): number {
    return (
      errors.length * 10 +
      errors.reduce((sum, error) => {
        if (
          typeof error.minimum_clearance === "number" &&
          typeof error.actual_clearance === "number"
        )
          return (
            sum + Math.max(0, error.minimum_clearance - error.actual_clearance)
          )
        const gap = String(error.message ?? "").match(/gap: (-?[\d.]+)mm/)
        return sum + (gap ? Math.max(0, 0.1 - Number(gap[1])) : 1)
      }, 0)
    )
  }

  private participants(error: ErrorRecord, result: Evaluation): Set<string> {
    const names = new Set<string>()
    if (typeof error.pcb_trace_id === "string") names.add(error.pcb_trace_id)
    for (const id of (error.pcb_trace_ids as string[] | undefined) ?? [])
      names.add(id)
    const pairId = String(error.pcb_trace_error_id ?? "")
    const prefix = `overlap_${error.pcb_trace_id}_`
    if (pairId.startsWith(prefix)) names.add(pairId.slice(prefix.length))
    const viaIds = new Set([
      ...((error.pcb_via_ids as string[] | undefined) ?? []),
      // Via-to-pad checks report via IDs in the pad participant list.
      ...((error.pcb_pad_ids as string[] | undefined) ?? []),
      error.pcb_via_id,
      ...Array.from(pairId.matchAll(/via_\d+/g), (match) => match[0]),
    ])
    for (const element of result.circuitJson) {
      if (
        element.type === "pcb_via" &&
        viaIds.has(element.pcb_via_id) &&
        element.pcb_trace_id
      )
        names.add(element.pcb_trace_id)
    }
    return names
  }

  private beginRelaxation(): void {
    const routes = this.traces.map((trace) =>
      convertSimplifiedPcbTraceToHighDensityRoute(trace, {
        layerCount: this.srj.layerCount,
        defaultTraceThickness: this.srj.minTraceWidth,
        defaultViaDiameter:
          this.srj.minViaPadDiameter ?? this.srj.minViaDiameter ?? 0.6,
        rootConnectionName: trace.connection_name,
      }),
    )
    this.hdInput = structuredClone(routes)
    this.relaxation = new RelaxTraceClearanceSolver({
      srj: { ...this.srj, traces: undefined },
      routes,
      bounds: this.srj.bounds,
      boundaryMargin: 0,
      boardEdgeClearance: this.srj.minBoardEdgeClearance ?? 0,
      allowViaMovement: true,
      traceClearance: (this.srj.minTraceToPadEdgeClearance ?? 0.1) + 0.0001,
      viaClearance: (this.srj.minPadEdgeToPadEdgeClearance ?? 0.1) + 0.0001,
      lockedPointIndices: routes.map((route, index) =>
        route.route.map(
          (point) =>
            this.locked.has(this.traces[index]!.pcb_trace_id) ||
            this.terminals.has(`${point.x.toFixed(7)},${point.y.toFixed(7)}`),
        ),
      ),
    })
    this.activeSubSolver = this.relaxation
  }

  private selectRelaxation(): void {
    const routes = this.relaxation!.getOutput()
    let candidate = this.traces.map((trace, index): SimplifiedPcbTrace => {
      if (this.locked.has(trace.pcb_trace_id)) return trace
      const moves = new Map(
        this.hdInput![index]!.route.map(
          (point, pointIndex) =>
            [
              `${point.x},${point.y}`,
              routes[index]!.route[pointIndex]!,
            ] as const,
        ),
      )
      return {
        ...trace,
        route: trace.route.map((point) => {
          if (point.route_type !== "wire" && point.route_type !== "via")
            return point
          const move = moves.get(`${point.x},${point.y}`)
          return move ? { ...point, x: move.x, y: move.y } : point
        }),
      }
    })
    const baseline = new Map(
      this.result.errors.map((error) => [
        this.errorKey(error),
        this.score([error]),
      ]),
    )
    // Roll back connected participants of new or worsened errors together.
    for (let attempt = 0; attempt <= this.traces.length; attempt++) {
      const result = this.evaluate(candidate)
      const rejected = new Set<string>()
      for (const error of result.errors) {
        const previous = baseline.get(this.errorKey(error))
        if (previous !== undefined && this.score([error]) <= previous + 1e-8)
          continue
        for (const id of this.participants(error, result)) rejected.add(id)
      }
      if (rejected.size === 0) {
        if (this.score(result.errors) < this.score(this.result.errors)) {
          this.traces = candidate
          this.result = result
        }
        break
      }
      let changed = false
      candidate = candidate.map((trace, index) => {
        if (!rejected.has(trace.pcb_trace_id) || trace === this.original[index])
          return trace
        changed = true
        return this.original[index]!
      })
      if (!changed) break
    }
    this.phase = "vias"
    this.beginViaPass()
  }

  private beginViaPass(): void {
    if (
      this.result.errors.length === 0 ||
      this.pass >= 8 ||
      (this.pass > 0 && !this.passImproved)
    ) {
      this.solved = true
      return
    }
    this.pass++
    this.passImproved = false
    const affected = new Set(
      this.result.errors.flatMap((error) => [
        ...this.participants(error, this.result),
      ]),
    )
    const errorViaIds = new Set(
      this.result.errors.flatMap((error) => [
        ...((error.pcb_via_ids as string[] | undefined) ?? []),
        // Via-to-pad checks report via IDs in the pad participant list.
        ...((error.pcb_pad_ids as string[] | undefined) ?? []),
        error.pcb_via_id,
      ]),
    )
    const errorViaCoordinates = new Set(
      this.result.circuitJson.flatMap((element) =>
        element.type === "pcb_via" && errorViaIds.has(element.pcb_via_id)
          ? [`${element.pcb_trace_id}:${element.x},${element.y}`]
          : [],
      ),
    )
    this.pending = this.traces.flatMap((trace) => {
      if (
        this.locked.has(trace.pcb_trace_id) ||
        !affected.has(trace.pcb_trace_id)
      )
        return []
      return trace.route.flatMap((point) =>
        point.route_type === "via" &&
        errorViaCoordinates.has(
          `${trace.pcb_trace_id}:${point.x},${point.y}`,
        ) &&
        !this.terminals.has(`${point.x.toFixed(7)},${point.y.toFixed(7)}`)
          ? [{ traceId: trace.pcb_trace_id, via: point }]
          : [],
      )
    })
    this.candidateIndex = 0
    this.best = undefined
    if (this.pending.length === 0) this.solved = true
  }

  private stepViaCandidate(): void {
    const target = this.pending[0]
    if (!target) {
      this.beginViaPass()
      return
    }
    if (!this.best)
      this.best = {
        traces: this.traces,
        result: this.result,
        score: this.score(this.result.errors),
      }
    const offset = OFFSETS[this.candidateIndex++]
    if (!offset) {
      if (this.best.traces !== this.traces) {
        this.traces = this.best.traces
        this.result = this.best.result
        this.passImproved = true
      }
      this.pending.shift()
      this.candidateIndex = 0
      this.best = undefined
      if (this.result.errors.length === 0) this.solved = true
      return
    }
    const owner = this.traces.find(
      (trace) => trace.pcb_trace_id === target.traceId,
    )!
    const net = this.connectivity.getNetConnectedToId(owner.connection_name)
    const sameNet = this.traces.filter(
      (trace) =>
        this.connectivity.getNetConnectedToId(trace.connection_name) === net,
    )
    // A via on the interior of another segment is a junction, not a movable vertex.
    for (const trace of sameNet) {
      for (let index = 1; index < trace.route.length; index++) {
        const a = trace.route[index - 1]!,
          b = trace.route[index]!
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== b.layer
        )
          continue
        if (
          pointToSegmentDistance(target.via, a, b) < 1e-7 &&
          Math.hypot(a.x - target.via.x, a.y - target.via.y) > 1e-7 &&
          Math.hypot(b.x - target.via.x, b.y - target.via.y) > 1e-7
        ) {
          this.candidateIndex = OFFSETS.length
          return
        }
      }
    }
    if (
      sameNet.some(
        (trace) =>
          this.locked.has(trace.pcb_trace_id) &&
          trace.route.some(
            (point) =>
              (point.route_type === "wire" || point.route_type === "via") &&
              point.x === target.via.x &&
              point.y === target.via.y,
          ),
      )
    ) {
      this.candidateIndex = OFFSETS.length
      return
    }
    const candidate = this.traces.map((trace) =>
      !sameNet.includes(trace)
        ? trace
        : {
            ...trace,
            route: trace.route.map((point) =>
              (point.route_type === "wire" || point.route_type === "via") &&
              point.x === target.via.x &&
              point.y === target.via.y
                ? { ...point, x: point.x + offset.x, y: point.y + offset.y }
                : point,
            ),
          },
    )
    const result = this.evaluate(candidate)
    const score = this.score(result.errors)
    if (
      score < this.best.score &&
      !result.errors.some((error) =>
        String(error.message).includes("accidental contact"),
      )
    ) {
      this.best = { traces: candidate, result, score }
      // Once an issue disappears, publish the bounded improvement and reassess.
      if (result.errors.length < this.result.errors.length)
        this.candidateIndex = OFFSETS.length
    }
  }

  override _step(): void {
    if (this.phase === "relax") {
      if (!this.relaxation) this.beginRelaxation()
      this.relaxation!.step()
      if (this.relaxation!.failed)
        throw new Error(
          `Constrained clearance relaxation failed: ${this.relaxation!.error}`,
        )
      if (this.relaxation!.solved) {
        this.phase = "select"
        this.activeSubSolver = null
      }
      return
    }
    if (this.phase === "select") {
      this.selectRelaxation()
      return
    }
    this.stepViaCandidate()
  }
}
