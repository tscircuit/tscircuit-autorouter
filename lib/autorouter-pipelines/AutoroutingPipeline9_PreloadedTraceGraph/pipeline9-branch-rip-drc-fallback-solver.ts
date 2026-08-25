import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getPipeline9DrcErrorTraceIds } from "./pipeline9-joint-drc-repair-utils"

type NestedPipeline9Solver = BaseSolver & {
  getOutputSimpleRouteJson: () => SimpleRouteJson
}

type Pipeline9BranchRipDrcFallbackSolverParams = {
  originalSrj: SimpleRouteJson
  currentTraces: SimplifiedPcbTraces
  eligibleTraceIds: ReadonlySet<string>
  createNestedSolver: (input: SimpleRouteJson) => NestedPipeline9Solver
}

type WireRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

type BranchCandidate = {
  trace: SimplifiedPcbTrace
  syntheticConnectionName: string
  traceWidth: number
  start: ReturnType<typeof getTraceEndpoint>
  end: ReturnType<typeof getTraceEndpoint>
}

const COORDINATE_EPSILON = 1e-9

const getWirePoints = (trace: SimplifiedPcbTrace): WireRoutePoint[] =>
  trace.route.filter(
    (point): point is WireRoutePoint => point.route_type === "wire",
  )

const getTraceEndpoint = (trace: SimplifiedPcbTrace, side: "start" | "end") => {
  const wirePoints = getWirePoints(trace)
  const point = side === "start" ? wirePoints[0] : wirePoints.at(-1)
  if (!point) return undefined
  return {
    x: point.x,
    y: point.y,
    layer: point.layer,
    pcb_port_id:
      side === "start"
        ? (point.start_pcb_port_id ?? trace.connectsTo?.[0])
        : (point.end_pcb_port_id ?? trace.connectsTo?.[1]),
  }
}

const getTraceLength = (trace: SimplifiedPcbTrace) => {
  let length = 0
  let previous: WireRoutePoint | undefined
  for (const point of trace.route) {
    if (point.route_type !== "wire") {
      previous = undefined
      continue
    }
    if (previous && previous.layer === point.layer) {
      length += Math.hypot(point.x - previous.x, point.y - previous.y)
    }
    previous = point
  }
  return length
}

const endpointsMatch = (
  left: NonNullable<ReturnType<typeof getTraceEndpoint>>,
  right: NonNullable<ReturnType<typeof getTraceEndpoint>>,
) =>
  left.layer === right.layer &&
  Math.abs(left.x - right.x) <= COORDINATE_EPSILON &&
  Math.abs(left.y - right.y) <= COORDINATE_EPSILON

const endpointIdentityMatches = (
  expected: NonNullable<ReturnType<typeof getTraceEndpoint>>,
  actual: NonNullable<ReturnType<typeof getTraceEndpoint>>,
) => expected.pcb_port_id === actual.pcb_port_id

const stringSetsMatch = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
) =>
  JSON.stringify([...(left ?? [])].sort()) ===
  JSON.stringify([...(right ?? [])].sort())

const getWireWidths = (trace: SimplifiedPcbTrace) =>
  [...new Set(getWirePoints(trace).map((point) => point.width))].sort(
    (left, right) => left - right,
  )

const getViaDimensions = (trace: SimplifiedPcbTrace) =>
  [
    ...new Set(
      trace.route
        .filter((point) => point.route_type === "via")
        .map(
          (point) =>
            `${point.via_diameter ?? "default"}:${point.via_hole_diameter ?? "default"}`,
        ),
    ),
  ].sort()

const tracePreservesElectricalInvariants = (
  expectedTrace: SimplifiedPcbTrace,
  actualTrace: SimplifiedPcbTrace,
) => {
  if (actualTrace.connection_name !== expectedTrace.connection_name)
    return false
  const expectedStart = getTraceEndpoint(expectedTrace, "start")
  const expectedEnd = getTraceEndpoint(expectedTrace, "end")
  const actualStart = getTraceEndpoint(actualTrace, "start")
  const actualEnd = getTraceEndpoint(actualTrace, "end")
  if (!expectedStart || !expectedEnd || !actualStart || !actualEnd) return false
  const endpointsPreserved =
    (endpointsMatch(expectedStart, actualStart) &&
      endpointIdentityMatches(expectedStart, actualStart) &&
      endpointsMatch(expectedEnd, actualEnd) &&
      endpointIdentityMatches(expectedEnd, actualEnd)) ||
    (endpointsMatch(expectedStart, actualEnd) &&
      endpointIdentityMatches(expectedStart, actualEnd) &&
      endpointsMatch(expectedEnd, actualStart) &&
      endpointIdentityMatches(expectedEnd, actualStart))
  return (
    endpointsPreserved &&
    stringSetsMatch(actualTrace.connectsTo, expectedTrace.connectsTo) &&
    JSON.stringify(getWireWidths(actualTrace)) ===
      JSON.stringify(getWireWidths(expectedTrace)) &&
    JSON.stringify(getViaDimensions(actualTrace)) ===
      JSON.stringify(getViaDimensions(expectedTrace))
  )
}

const candidatePreservesElectricalInvariants = ({
  candidate,
  reroutedTraces,
}: {
  candidate: BranchCandidate
  reroutedTraces: SimplifiedPcbTraces
}) => {
  if (!candidate.start || !candidate.end || reroutedTraces.length !== 1) {
    return false
  }
  const reroutedTrace = reroutedTraces[0]!
  const reroutedStart = getTraceEndpoint(reroutedTrace, "start")
  const reroutedEnd = getTraceEndpoint(reroutedTrace, "end")
  if (!reroutedStart || !reroutedEnd) return false
  const endpointsPreserved =
    (endpointsMatch(candidate.start, reroutedStart) &&
      endpointsMatch(candidate.end, reroutedEnd)) ||
    (endpointsMatch(candidate.start, reroutedEnd) &&
      endpointsMatch(candidate.end, reroutedStart))
  if (!endpointsPreserved) return false

  return (
    JSON.stringify(getWireWidths(reroutedTrace)) ===
      JSON.stringify(getWireWidths(candidate.trace)) &&
    JSON.stringify(getViaDimensions(reroutedTrace)) ===
      JSON.stringify(getViaDimensions(candidate.trace))
  )
}

const reconnectReroutedTrace = (
  trace: SimplifiedPcbTrace,
  candidate: BranchCandidate,
): SimplifiedPcbTrace => {
  if (!candidate.start || !candidate.end) return trace
  const actualStart = getTraceEndpoint(trace, "start")
  const actualEnd = getTraceEndpoint(trace, "end")
  if (!actualStart || !actualEnd) return trace
  const forward =
    endpointsMatch(candidate.start, actualStart) &&
    endpointsMatch(candidate.end, actualEnd)
  const startPcbPortId = forward
    ? candidate.start.pcb_port_id
    : candidate.end.pcb_port_id
  const endPcbPortId = forward
    ? candidate.end.pcb_port_id
    : candidate.start.pcb_port_id
  const route = trace.route.map((point) => ({ ...point }))
  const firstWireIndex = route.findIndex((point) => point.route_type === "wire")
  const lastWireIndex = route.findLastIndex(
    (point) => point.route_type === "wire",
  )
  const firstWire = route[firstWireIndex]
  const lastWire = route[lastWireIndex]
  if (firstWire?.route_type === "wire" && startPcbPortId) {
    firstWire.start_pcb_port_id = startPcbPortId
  }
  if (lastWire?.route_type === "wire" && endPcbPortId) {
    lastWire.end_pcb_port_id = endPcbPortId
  }
  return {
    ...trace,
    connection_name: candidate.trace.connection_name,
    connectsTo: candidate.trace.connectsTo
      ? [...candidate.trace.connectsTo]
      : undefined,
    route,
  }
}

/**
 * Last-resort Pipeline 9 repair for one remaining trace-pair DRC. Only a
 * newly-routed participant may be removed; every other trace is supplied to a
 * nested Pipeline 9 run as pre-routed copper while it reconnects the same two
 * endpoints. Pipeline 9 may adjust that copper, but a candidate is accepted
 * only when all electrical invariants survive and full-board DRC improves.
 */
export class Pipeline9BranchRipDrcFallbackSolver extends BaseSolver {
  readonly params: Pipeline9BranchRipDrcFallbackSolverParams
  private initialized = false
  private candidates: BranchCandidate[] = []
  private candidateCursor = 0
  private activeCandidate?: BranchCandidate
  private activeNestedSolver?: NestedPipeline9Solver
  private initialDrcCount = 0
  private outputTraces: SimplifiedPcbTraces

  constructor(params: Pipeline9BranchRipDrcFallbackSolverParams) {
    super()
    this.params = params
    this.outputTraces = structuredClone(params.currentTraces)
    this.MAX_ITERATIONS = 100e6
  }

  private initialize() {
    this.initialized = true
    const result = evaluateRelaxedDrc({
      inputSrj: { ...this.params.originalSrj, traces: [] },
      srjWithPointPairs: this.params.originalSrj,
      routedTraces: this.params.currentTraces,
    })
    this.initialDrcCount = result.errors.length
    this.stats.initialDrcCount = this.initialDrcCount
    if (
      result.errors.length !== 1 ||
      result.errors[0]?.type !== "pcb_trace_error"
    ) {
      this.stats.skipped = true
      this.solved = true
      return
    }

    const traceById = new Map(
      this.params.currentTraces.map((trace) => [trace.pcb_trace_id, trace]),
    )
    this.candidates = getPipeline9DrcErrorTraceIds(
      result.errors[0] as unknown as Record<string, unknown>,
    )
      .filter((traceId) => this.params.eligibleTraceIds.has(traceId))
      .map((traceId) => traceById.get(traceId))
      .filter((trace): trace is SimplifiedPcbTrace => Boolean(trace))
      .map((trace, index) => {
        const wirePoints = getWirePoints(trace)
        return {
          trace,
          syntheticConnectionName: `${trace.connection_name}_branch_reroute_${index}`,
          traceWidth:
            wirePoints[0]?.width ?? this.params.originalSrj.minTraceWidth,
          start: getTraceEndpoint(trace, "start"),
          end: getTraceEndpoint(trace, "end"),
        }
      })
      .filter((candidate): candidate is BranchCandidate =>
        Boolean(candidate.start && candidate.end),
      )
      .sort(
        (left, right) =>
          getTraceLength(left.trace) - getTraceLength(right.trace),
      )
    this.stats.candidateCount = this.candidates.length
    if (this.candidates.length === 0) this.solved = true
  }

  private startNextCandidate() {
    const candidate = this.candidates[this.candidateCursor++]
    if (!candidate || !candidate.start || !candidate.end) {
      this.solved = true
      return
    }
    const rerouteInput: SimpleRouteJson = {
      ...structuredClone(this.params.originalSrj),
      connections: [
        {
          name: candidate.syntheticConnectionName,
          __rootConnectionNames: [candidate.trace.connection_name],
          nominalTraceWidth: candidate.traceWidth,
          pointsToConnect: [candidate.start, candidate.end],
        },
      ],
      differentialPairs: undefined,
      buses: undefined,
      traces: this.params.currentTraces.filter(
        (trace) => trace.pcb_trace_id !== candidate.trace.pcb_trace_id,
      ),
    }
    this.activeCandidate = candidate
    this.activeNestedSolver = this.params.createNestedSolver(rerouteInput)
    this.activeSubSolver = this.activeNestedSolver
    this.stats.candidatesAttempted =
      Number(this.stats.candidatesAttempted ?? 0) + 1
  }

  private evaluateActiveCandidate() {
    const candidate = this.activeCandidate
    const nestedSolver = this.activeNestedSolver
    this.activeCandidate = undefined
    this.activeNestedSolver = undefined
    this.activeSubSolver = undefined
    if (!candidate || !nestedSolver?.solved) return
    this.stats.lastNestedSolverIterations = nestedSolver.iterations

    const nestedOutput = nestedSolver.getOutputSimpleRouteJson().traces ?? []
    const preservedTraceById = new Map(
      this.params.currentTraces
        .filter((trace) => trace.pcb_trace_id !== candidate.trace.pcb_trace_id)
        .map((trace) => [trace.pcb_trace_id, trace]),
    )
    let preservedTraceMutationCount = 0
    const preservedTracesMaintainInvariants = [...preservedTraceById].every(
      ([traceId, expectedTrace]) => {
        const actualTrace = nestedOutput.find(
          (trace) => trace.pcb_trace_id === traceId,
        )
        if (
          actualTrace &&
          JSON.stringify(actualTrace.route) !==
            JSON.stringify(expectedTrace.route)
        ) {
          preservedTraceMutationCount += 1
        }
        return (
          actualTrace !== undefined &&
          tracePreservesElectricalInvariants(expectedTrace, actualTrace)
        )
      },
    )
    const reroutedTraces = nestedOutput.filter(
      (trace) => !preservedTraceById.has(trace.pcb_trace_id),
    )
    if (
      !candidatePreservesElectricalInvariants({ candidate, reroutedTraces })
    ) {
      this.stats.candidatesRejectedForInvariant =
        Number(this.stats.candidatesRejectedForInvariant ?? 0) + 1
      return
    }
    if (!preservedTracesMaintainInvariants) {
      this.stats.candidatesRejectedForElectricalInvariant =
        Number(this.stats.candidatesRejectedForElectricalInvariant ?? 0) + 1
      return
    }
    const reroutedTraceIds = new Set(
      reroutedTraces.map((trace) => trace.pcb_trace_id),
    )
    const reconnectedTraces = nestedOutput.map((trace) =>
      reroutedTraceIds.has(trace.pcb_trace_id)
        ? reconnectReroutedTrace(trace, candidate)
        : trace,
    )
    const originalPreloadedTraceById = new Map(
      (this.params.originalSrj.traces ?? []).map((trace) => [
        trace.pcb_trace_id,
        trace,
      ]),
    )
    const outputTraces = reconnectedTraces.map((trace) => {
      const originalPreloadedTrace = originalPreloadedTraceById.get(
        trace.pcb_trace_id,
      )
      if (
        !originalPreloadedTrace ||
        trace.__replaces_pcb_trace_id !== undefined ||
        JSON.stringify(trace.route) ===
          JSON.stringify(originalPreloadedTrace.route)
      ) {
        return trace
      }
      return {
        ...trace,
        __replaces_pcb_trace_id: originalPreloadedTrace.pcb_trace_id,
      }
    })
    const result = evaluateRelaxedDrc({
      inputSrj: { ...this.params.originalSrj, traces: [] },
      srjWithPointPairs: this.params.originalSrj,
      routedTraces: outputTraces,
    })
    if (result.errors.length >= this.initialDrcCount) return

    this.outputTraces = outputTraces
    this.stats.finalDrcCount = result.errors.length
    this.stats.acceptedTraceId = candidate.trace.pcb_trace_id
    this.stats.preservedTraceMutationCount = preservedTraceMutationCount
    this.solved = true
  }

  override _step() {
    if (!this.initialized) {
      this.initialize()
      return
    }
    if (this.activeNestedSolver) {
      this.activeNestedSolver.step()
      if (this.activeNestedSolver.solved || this.activeNestedSolver.failed) {
        this.evaluateActiveCandidate()
      }
      return
    }
    if (this.solved) return
    this.startNextCandidate()
  }

  getOutput(): SimplifiedPcbTraces {
    return structuredClone(this.outputTraces)
  }
}
