import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"

export const PAIR_METRIC_CONTRACT = {
  version: "sampled-copper-v2",
  sampleStepMm: 0.05,
  gapToleranceMm: 0.05,
  maximumParallelAngleDegrees: 15,
  uncoupledBudgetMeaning: "total planar uncoupled length per member including terminal escapes",
  boundaryToleranceMm: 0.05,
  pairResolution: "one output trace per two-terminal named connection; other structures unknown",
  length: "planar copper only; via barrel and resistor body lengths excluded",
  continuity: "single ordered continuous wire/via route; jumpers and through-obstacle routes unmeasurable",
  clearance: "repository evaluateRelaxedDrc with declared trace-pad clearance and board clearance; not full manufacturing DRC",
} as const

type Segment = { ax: number; ay: number; bx: number; by: number; layer: string; width: number; length: number }
type Verdict = "pass" | "fail" | "unknown" | "undeclared"
type Coupling = { lengthMm: number; coupledMm: number; uncoupledMm: number; coupledFraction: number | null; gapP10MedianP90Mm: number[]; minGapMm: number | null; maxGapMm: number | null }
export type PairQualityResult = { connectionNames: [string, string]; measurementStatus: "measured" | "unavailable" | "ambiguous"; routeCounts: number[]; lengthsMm: number[] | null; skewMm: number | null; skew: Verdict; gap: Verdict; maxUncoupled: Verdict; terminalCoverage: Verdict; fullCompliance: Verdict; coupling: Coupling[] | null; viaCounts: number[] | null; viaLayerSequences: string[][] | null }
export type PairOutputEvaluation = { outputAvailable: boolean; outputRouteCount: number; solved: boolean; failed: boolean; error: string | null; runtimeMs: number | null; timedOut: boolean; immutableCopperPreserved: Verdict; drcStatus: Verdict; drcErrorCount: number | null; drcError: string | null; pairs: PairQualityResult[]; metricContract: typeof PAIR_METRIC_CONTRACT }
export type PairEvaluationInput = { inputSrj: SimpleRouteJson; outputSrj: SimpleRouteJson | null; srjWithPointPairs?: SimpleRouteJson; solved: boolean; failed: boolean; error?: string | null; runtimeMs?: number; timedOut?: boolean }

function isContinuousTrace(trace: SimplifiedPcbTrace): boolean {
  for (let i = 0; i < trace.route.length; i++) {
    const point = trace.route[i]!
    if (point.route_type !== "wire" && point.route_type !== "via") return false
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
    if (point.route_type === "wire" && (!Number.isFinite(point.width) || point.width <= 0)) return false
    if (i === 0) continue
    const previous = trace.route[i - 1]!
    if (previous.route_type !== "wire" && previous.route_type !== "via") return false
    if (previous.route_type === "wire" && point.route_type === "wire") {
      if (previous.layer !== point.layer) return false
    } else {
      if (Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-6) return false
      const exitLayer = previous.route_type === "wire" ? previous.layer : previous.to_layer
      const entryLayer = point.route_type === "wire" ? point.layer : point.from_layer
      if (exitLayer !== entryLayer) return false
    }
  }
  return trace.route.length > 1
}

function getSegments(trace: SimplifiedPcbTrace): Segment[] {
  const segments: Segment[] = []
  for (let i = 1; i < trace.route.length; i++) {
    const a = trace.route[i - 1]!, b = trace.route[i]!
    if (a.route_type !== "wire" || b.route_type !== "wire" || a.layer !== b.layer) continue
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length <= 1e-10) continue
    segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, layer: a.layer, width: Math.max(a.width, b.width), length })
  }
  return segments
}

function pointDistance(x: number, y: number, segment: Segment): number {
  const dx = segment.bx - segment.ax, dy = segment.by - segment.ay
  const t = Math.max(0, Math.min(1, ((x - segment.ax) * dx + (y - segment.ay) * dy) / segment.length ** 2))
  const closestX = segment.ax + dx * t
  const closestY = segment.ay + dy * t
  const distance = Math.hypot(x - closestX, y - closestY)
  return distance
}

function measureCoupling(a: Segment[], b: Segment[], targetGap: number): Coupling {
  let lengthMm = 0, coupledMm = 0
  const gaps: { gap: number; weight: number }[] = []
  for (const s of a) {
    const count = Math.ceil(s.length / 0.05), weight = s.length / count
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count, x = s.ax + t * (s.bx - s.ax), y = s.ay + t * (s.by - s.ay)
      let distance = Infinity, partner: Segment | null = null
      for (const q of b) {
        if (q.layer !== s.layer) continue
        const candidateDistance = pointDistance(x, y, q)
        if (candidateDistance < distance) { distance = candidateDistance; partner = q }
      }
      lengthMm += weight
      if (!partner) continue
      const gap = distance - (s.width + partner.width) / 2
      gaps.push({ gap, weight })
      const cosine = Math.abs(((s.bx - s.ax) * (partner.bx - partner.ax) + (s.by - s.ay) * (partner.by - partner.ay)) / s.length / partner.length)
      if (Math.abs(gap - targetGap) <= 0.05 && cosine >= Math.cos(Math.PI / 12)) coupledMm += weight
    }
  }
  gaps.sort((x, y) => x.gap - y.gap)
  const percentiles: number[] = [], measuredLength = gaps.reduce((sum, p) => sum + p.weight, 0)
  for (const q of [0.1, 0.5, 0.9]) {
    let accumulated = 0
    for (const sample of gaps) { accumulated += sample.weight; if (accumulated >= measuredLength * q) { percentiles.push(sample.gap); break } }
  }
  return { lengthMm, coupledMm, uncoupledMm: lengthMm - coupledMm, coupledFraction: lengthMm ? coupledMm / lengthMm : null, gapP10MedianP90Mm: percentiles, minGapMm: gaps[0]?.gap ?? null, maxGapMm: gaps.at(-1)?.gap ?? null }
}

/** Evaluate emitted copper independently of solver success flags; missing constraints are never defaults. */
export function evaluatePairOutput(input: PairEvaluationInput): PairOutputEvaluation {
  const traces = input.outputSrj?.traces ?? []
  const pairs: PairQualityResult[] = (input.inputSrj.differentialPairs ?? []).map((pair) => {
    const members = pair.connectionNames.map((name) => traces.filter((t) => t.connection_name === name))
    const connections = pair.connectionNames.map((name) => input.inputSrj.connections.find((c) => c.name === name))
    const measured = members.every((ts) => ts.length === 1) && connections.every((c) => c && c.pointsToConnect.length === 2)
    const base: PairQualityResult = { connectionNames: pair.connectionNames, measurementStatus: members.some((ts) => ts.length === 0) ? "unavailable" : "ambiguous", routeCounts: members.map((ts) => ts.length), lengthsMm: null, skewMm: null, skew: Number.isFinite(pair.lengthTolerance) ? "unknown" : "undeclared", gap: pair.traceGap === undefined ? "undeclared" : "unknown", maxUncoupled: pair.maxUncoupledLength === undefined ? "undeclared" : "unknown", terminalCoverage: "unknown", fullCompliance: "unknown", coupling: null, viaCounts: null, viaLayerSequences: null }
    if (!measured || members.some((ts) => !isContinuousTrace(ts[0]!))) return base
    const segments = members.map((ts) => getSegments(ts[0]!))
    if (segments.some((ss) => ss.length === 0)) return base
    const lengths = segments.map((ss) => ss.reduce((sum, s) => sum + s.length, 0))
    const skewMm = Math.abs(lengths[0]! - lengths[1]!)
    const terminalCoverage = connections.every((c, i) => c!.pointsToConnect.every((p) => {
      const layers = p.layer !== undefined ? [p.layer] : p.layers
      const touchesWire = segments[i]!.some((s) => layers.includes(s.layer) && pointDistance(p.x, p.y, s) <= 1e-5)
      const touchesVia = members[i]![0]!.route.some((point) => point.route_type === "via" && Math.hypot(point.x - p.x, point.y - p.y) <= 1e-5 && layers.some((layer) => layer === point.from_layer || layer === point.to_layer || point.layers?.includes(layer)))
      return touchesWire || touchesVia
    }))
    const coupling = pair.traceGap === undefined ? null : [measureCoupling(segments[0]!, segments[1]!, pair.traceGap), measureCoupling(segments[1]!, segments[0]!, pair.traceGap)]
    const vias = members.map((ts) => ts[0]!.route.filter((p) => p.route_type === "via"))
    const budgetVerdict: Verdict = pair.maxUncoupledLength === undefined ? "undeclared" : coupling ? (coupling.every((c) => c.uncoupledMm <= pair.maxUncoupledLength! + 0.05) ? "pass" : "fail") : "unknown"
    // Corpus contract: gap compliance is covered by the declared total uncoupled budget,
    // using the sampling tolerance and angular threshold recorded in metricContract.
    return { ...base, measurementStatus: "measured", lengthsMm: lengths, skewMm, skew: Number.isFinite(pair.lengthTolerance) ? (skewMm <= pair.lengthTolerance + 1e-6 ? "pass" : "fail") : "undeclared", terminalCoverage: terminalCoverage ? "pass" : "fail", coupling, gap: pair.traceGap === undefined ? "undeclared" : pair.maxUncoupledLength === undefined ? "unknown" : budgetVerdict, maxUncoupled: budgetVerdict, viaCounts: vias.map((v) => v.length), viaLayerSequences: vias.map((v) => v.map((p) => `${p.from_layer}->${p.to_layer}`)) }
  })
  const result: PairOutputEvaluation = { outputAvailable: input.outputSrj !== null && traces.length > 0, outputRouteCount: traces.length, solved: input.solved, failed: input.failed, error: input.error ?? null, runtimeMs: input.runtimeMs ?? null, timedOut: input.timedOut ?? false, immutableCopperPreserved: input.outputSrj === null ? "unknown" : "pass", drcStatus: "unknown", drcErrorCount: null, drcError: null, pairs, metricContract: PAIR_METRIC_CONTRACT }
  if (!input.outputSrj) return result
  for (const fixed of input.inputSrj.traces ?? []) {
    const emitted = traces.find((t) => t.pcb_trace_id === fixed.pcb_trace_id)
    if (!emitted || JSON.stringify(emitted.route) !== JSON.stringify(fixed.route)) result.immutableCopperPreserved = "fail"
  }
  try {
    const fixedIds = new Set((input.inputSrj.traces ?? []).map((t) => t.pcb_trace_id))
    const drc = evaluateRelaxedDrc({ inputSrj: input.inputSrj, srjWithPointPairs: input.srjWithPointPairs ?? input.inputSrj, routedTraces: traces.filter((t) => !fixedIds.has(t.pcb_trace_id)), includeBoardClearance: true, drcOptions: { traceClearance: input.inputSrj.minTraceToPadEdgeClearance } })
    result.drcErrorCount = drc.errors.length
    result.drcStatus = drc.errors.length ? "fail" : "pass"
  } catch (error) { result.drcError = String(error) }
  for (const pair of result.pairs) {
    const checks = [pair.skew, pair.gap, pair.maxUncoupled, pair.terminalCoverage, result.immutableCopperPreserved, result.drcStatus].filter((v) => v !== "undeclared")
    pair.fullCompliance = checks.includes("fail") ? "fail" : checks.includes("unknown") ? "unknown" : "pass"
  }
  return result
}
