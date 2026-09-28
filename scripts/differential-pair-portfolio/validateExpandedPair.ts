import type {
  HighDensityRoute,
  PostProcessingSolverParams,
} from "@tscircuit/length-matching-solver"
import { createPostProcessingModel } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/binding/createPostProcessingModel"
import { parseSimplifiedPcbTrace } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/model/parseSimplifiedPcbTrace"
import { validateCandidateGeometry } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/geometry/validateCandidateGeometry"
import type { ParsedTrace } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/model/internal-types"

export type ExpandedPairConstraint = {
  connectionNames: [string, string]
  traceGap?: number
  maxUncoupledLength?: number
  lengthTolerance?: number
}
export type ExpandedPairIssue = {
  code: string
  message: string
  connectionNames?: string[]
}
export type ExpandedPairMetrics = {
  connectionNames: [string, string]
  lengthsMm: number[]
  skewMm: number
  viaCounts: number[]
  uncoupledMm: number[] | null
  terminalUncoupledMm: number[][] | null
  interiorUncoupledMm: number[] | null
  coupledFraction: number[] | null
}
export type ExpandedPairValidation = {
  status: "valid" | "invalid" | "unsupported"
  issues: ExpandedPairIssue[]
  pairs: ExpandedPairMetrics[]
}
export type ValidateExpandedPairInput = {
  params: PostProcessingSolverParams
  candidateHdRoutes: HighDensityRoute[]
  constraints?: ExpandedPairConstraint[]
}

type SampledCoupling = {
  length: number
  uncoupled: number
  startUncoupled: number
  endUncoupled: number
  interiorUncoupled: number
}

function measureLane(
  source: ParsedTrace,
  partner: ParsedTrace,
  gap: number,
): SampledCoupling {
  let length = 0,
    uncoupled = 0,
    startUncoupled = 0,
    endUncoupled = 0
  let foundCoupled = false
  for (const segment of source.segments) {
    const dx = segment.end.x - segment.start.x,
      dy = segment.end.y - segment.start.y
    const segmentLength = Math.hypot(dx, dy)
    if (segmentLength < 1e-10) continue
    const count = Math.ceil(segmentLength / 0.02),
      weight = segmentLength / count
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count,
        x = segment.start.x + t * dx,
        y = segment.start.y + t * dy
      let nearest = Infinity,
        nearestGap = Infinity,
        alignment = 0
      for (const other of partner.segments) {
        if (other.layer !== segment.layer) continue
        const ox = other.end.x - other.start.x,
          oy = other.end.y - other.start.y
        const otherLength = Math.hypot(ox, oy)
        if (otherLength < 1e-10) continue
        const u = Math.max(
          0,
          Math.min(
            1,
            ((x - other.start.x) * ox + (y - other.start.y) * oy) /
              otherLength ** 2,
          ),
        )
        const distance = Math.hypot(
          x - other.start.x - u * ox,
          y - other.start.y - u * oy,
        )
        if (distance < nearest) {
          nearest = distance
          nearestGap = distance - (segment.width + other.width) / 2
          alignment = Math.abs(
            (dx * ox + dy * oy) / segmentLength / otherLength,
          )
        }
      }
      length += weight
      if (
        Math.abs(nearestGap - gap) > 0.05 ||
        alignment < Math.cos(Math.PI / 12)
      ) {
        uncoupled += weight
        endUncoupled += weight
        if (!foundCoupled) startUncoupled += weight
      } else {
        foundCoupled = true
        endUncoupled = 0
      }
    }
  }
  return {
    length,
    uncoupled,
    startUncoupled,
    endUncoupled,
    interiorUncoupled: foundCoupled
      ? Math.max(0, uncoupled - startUncoupled - endUncoupled)
      : 0,
  }
}

/** Validate expanded and tuned copper transactionally; callers keep their incumbent unless valid. */
export function validateExpandedPair(
  input: ValidateExpandedPairInput,
): ExpandedPairValidation {
  const result: ExpandedPairValidation = {
    status: "valid",
    issues: [],
    pairs: [],
  }
  const pairNames = new Set(
    input.params.differentialPairs.flatMap((p) => p.connectionNames),
  )
  const fail = (
    code: string,
    message: string,
    connectionNames?: string[],
  ): void => {
    result.issues.push({ code, message, connectionNames })
    result.status = "invalid"
  }
  const unsupported = (message: string, connectionNames?: string[]): void => {
    result.issues.push({ code: "unsupported", message, connectionNames })
    if (result.status === "valid") result.status = "unsupported"
  }
  if (input.params.differentialPairs.length === 0)
    unsupported("No differential pair was supplied for validation")
  for (const pair of input.params.differentialPairs) {
    if (!Number.isFinite(pair.lengthTolerance) || pair.lengthTolerance < 0)
      fail(
        "invalid-constraint",
        "Length tolerance must be finite and nonnegative",
        pair.connectionNames,
      )
  }
  for (const constraint of input.constraints ?? []) {
    for (const value of [
      constraint.traceGap,
      constraint.maxUncoupledLength,
      constraint.lengthTolerance,
    ]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0))
        fail(
          "invalid-constraint",
          "Hard constraints must be finite and nonnegative",
          constraint.connectionNames,
        )
    }
  }
  if (input.candidateHdRoutes.length !== input.params.hdRoutes.length)
    fail(
      "route-count",
      "Expanded output changed the number of routed connections",
    )
  for (let index = 0; index < input.params.hdRoutes.length; index++) {
    const original = input.params.hdRoutes[index]!
    const candidate = input.candidateHdRoutes[index]
    if (!candidate || candidate.connectionName !== original.connectionName) {
      fail(
        "route-identity",
        `Output route ${index} no longer matches ${original.connectionName}`,
      )
      continue
    }
    if (
      !pairNames.has(original.connectionName) &&
      JSON.stringify(candidate) !== JSON.stringify(original)
    )
      fail(
        "immutable-copper",
        `Unrelated route ${original.connectionName} changed`,
      )
    if (!pairNames.has(original.connectionName)) continue
    if (
      candidate.traceThickness !== original.traceThickness ||
      candidate.viaDiameter !== original.viaDiameter ||
      candidate.rootConnectionName !== original.rootConnectionName
    )
      fail(
        "copper-metadata",
        `Pair member ${original.connectionName} changed width, via diameter, or root identity`,
      )
    if (
      candidate.jumpers?.length ||
      candidate.route.some((p) => p.toNextSegmentType)
    ) {
      unsupported("Pair uses unsupported jumper or through-obstacle geometry", [
        original.connectionName,
      ])
      continue
    }
    if (candidate.route.length < 2) {
      fail(
        "empty-route",
        `Pair member ${original.connectionName} has no continuous route`,
      )
      continue
    }
    for (const end of [0, -1]) {
      const a = original.route.at(end),
        b = candidate.route.at(end)
      if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) > 1e-7 || a.z !== b.z)
        fail(
          "endpoint",
          `Pair member ${original.connectionName} moved an endpoint or its layer`,
        )
    }
    if (
      (original.startPcbPortId ?? original.route[0]?.pcb_port_id) !==
        (candidate.startPcbPortId ?? candidate.route[0]?.pcb_port_id) ||
      (original.endPcbPortId ?? original.route.at(-1)?.pcb_port_id) !==
        (candidate.endPcbPortId ?? candidate.route.at(-1)?.pcb_port_id)
    )
      fail(
        "endpoint-metadata",
        `Pair member ${original.connectionName} changed endpoint identity`,
      )
    const minimumOriginalWidth = Math.min(
      original.traceThickness,
      ...original.route.map((p) => p.traceThickness ?? original.traceThickness),
    )
    const transitions: { x: number; y: number }[] = []
    for (let i = 0; i < candidate.route.length; i++) {
      const point = candidate.route[i]!
      if (
        ![
          point.x,
          point.y,
          point.z,
          point.traceThickness ?? candidate.traceThickness,
        ].every(Number.isFinite) ||
        point.z < 0 ||
        point.z >= input.params.layerCount ||
        !Number.isInteger(point.z) ||
        (point.traceThickness ?? candidate.traceThickness) <= 0
      )
        fail("invalid-point", `Invalid point on ${original.connectionName}`)
      if (
        (point.traceThickness ?? candidate.traceThickness) <
        minimumOriginalWidth - 1e-9
      )
        fail(
          "copper-metadata",
          `Pair member ${original.connectionName} reduced its physical trace width`,
        )
      const previous = candidate.route[i - 1]
      if (previous && previous.z !== point.z) {
        if (Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-7)
          fail(
            "via-continuity",
            `Layer transition moves in plane on ${original.connectionName}`,
          )
        transitions.push(point)
      }
    }
    if (
      transitions.length !== candidate.vias.length ||
      transitions.some(
        (p) =>
          !candidate.vias.some((v) => Math.hypot(v.x - p.x, v.y - p.y) <= 1e-7),
      )
    )
      fail(
        "via-metadata",
        `Via list does not match layer transitions on ${original.connectionName}`,
      )
  }
  if (result.status === "invalid") return result
  let model: ReturnType<typeof createPostProcessingModel>
  try {
    model = createPostProcessingModel({
      ...input.params,
      hdRoutes: input.candidateHdRoutes,
    })
  } catch (error) {
    fail("model", String(error))
    return result
  }
  const srj = model.params.simpleRouteJson
  for (const pair of input.params.differentialPairs) {
    const memberIndexes = pair.connectionNames.map((name) =>
      input.candidateHdRoutes.flatMap((r, i) =>
        r.connectionName === name ? [i] : [],
      ),
    )
    if (memberIndexes.some((indexes) => indexes.length !== 1)) {
      unsupported(
        "Pair members must resolve to one route each",
        pair.connectionNames,
      )
      continue
    }
    const traces = memberIndexes.map((indexes) => srj.traces[indexes[0]!]!)
    let parsed: ParsedTrace[]
    try {
      parsed = traces.map((trace) =>
        parseSimplifiedPcbTrace(trace, input.params.layerCount),
      )
    } catch (error) {
      fail("continuity", String(error), pair.connectionNames)
      continue
    }
    const first = parsed[0]!,
      second = parsed[1]!
    const lengths = parsed.map((p) =>
      p.segments.reduce(
        (sum, s) => sum + Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y),
        0,
      ),
    )
    const constraint = input.constraints?.find(
      (c) =>
        c.connectionNames[0] === pair.connectionNames[0] &&
        c.connectionNames[1] === pair.connectionNames[1],
    )
    const tolerance = constraint?.lengthTolerance ?? pair.lengthTolerance
    const skew = Math.abs(lengths[0]! - lengths[1]!)
    if (Number.isFinite(tolerance) && skew > tolerance + 1e-6)
      fail(
        "length-skew",
        `Length mismatch ${skew} exceeds ${tolerance}mm`,
        pair.connectionNames,
      )
    const reverseSecond =
      Math.hypot(
        first.points[0]!.x - second.points.at(-1)!.x,
        first.points[0]!.y - second.points.at(-1)!.y,
      ) +
        Math.hypot(
          first.points.at(-1)!.x - second.points[0]!.x,
          first.points.at(-1)!.y - second.points[0]!.y,
        ) <
      Math.hypot(
        first.points[0]!.x - second.points[0]!.x,
        first.points[0]!.y - second.points[0]!.y,
      ) +
        Math.hypot(
          first.points.at(-1)!.x - second.points.at(-1)!.x,
          first.points.at(-1)!.y - second.points.at(-1)!.y,
        )
    const secondTransitions = reverseSecond
      ? [...second.transitions].reverse().map((v) => ({
          ...v,
          from_layer: v.to_layer,
          to_layer: v.from_layer,
        }))
      : second.transitions
    if (
      first.transitions.length !== secondTransitions.length ||
      first.transitions.some(
        (v, i) =>
          v.from_layer !== secondTransitions[i]?.from_layer ||
          v.to_layer !== secondTransitions[i]?.to_layer,
      )
    )
      fail(
        "paired-vias",
        "Pair members have different layer transition sequences",
        pair.connectionNames,
      )
    if (
      !validateCandidateGeometry(first, second, {
        obstacles: srj.obstacles,
        bounds: srj.bounds,
        layerCount: srj.layerCount,
        minTraceToPadEdgeClearance: srj.minTraceToPadEdgeClearance,
        immutableTraces: srj.traces.filter((t) => !traces.includes(t)),
      })
    )
      fail(
        "clearance",
        "Expanded copper violates bounds, self/partner clearance, or fixed copper",
        pair.connectionNames,
      )
    const coupling =
      constraint?.traceGap === undefined
        ? null
        : [
            measureLane(first, second, constraint.traceGap),
            measureLane(second, first, constraint.traceGap),
          ]
    const budget = constraint?.maxUncoupledLength ?? pair.maxUncoupledLength
    if (budget !== undefined && !coupling)
      unsupported(
        "Uncoupled budget declared without a hard gap target",
        pair.connectionNames,
      )
    if (
      budget !== undefined &&
      coupling?.some(
        (m) =>
          m.startUncoupled > budget + 0.02 || m.endUncoupled > budget + 0.02,
      )
    )
      fail(
        "uncoupled-length",
        `Sampled terminal escape exceeds ${budget}mm on a member endpoint`,
        pair.connectionNames,
      )
    if (coupling?.some((m) => m.length - m.uncoupled <= 1e-7))
      fail(
        "uncoupled-trunk",
        "No coupled trunk exists at the declared gap",
        pair.connectionNames,
      )
    if (coupling?.some((m) => m.interiorUncoupled > 0.05))
      fail(
        "interior-gap",
        "Expanded trunk departs from the declared gap outside terminal escapes",
        pair.connectionNames,
      )
    result.pairs.push({
      connectionNames: pair.connectionNames,
      lengthsMm: lengths,
      skewMm: skew,
      viaCounts: parsed.map((p) => p.transitions.length),
      uncoupledMm: coupling?.map((m) => m.uncoupled) ?? null,
      terminalUncoupledMm:
        coupling?.map((m) => [m.startUncoupled, m.endUncoupled]) ?? null,
      interiorUncoupledMm: coupling?.map((m) => m.interiorUncoupled) ?? null,
      coupledFraction:
        coupling?.map((m) => (m.length ? 1 - m.uncoupled / m.length : 0)) ??
        null,
    })
  }
  return result
}
