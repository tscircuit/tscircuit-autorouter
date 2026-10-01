import type { SimplifiedPcbTrace } from "../../types"
import { minimumDistanceBetweenSegments } from "../../utils/minimumDistanceBetweenSegments"
import {
  createDynamicNetTreeProblem,
  type PostRoutingPhysicalInput,
} from "../DynamicNetTreeSolver/createDynamicNetTreeProblem"
import {
  copperRectangleCorners,
  copperTouches,
  pointInOutline,
  segmentCopperGap,
  type TreeCopper,
} from "../DynamicNetTreeSolver/dynamicNetTreeGeometry"

export type PostRoutingValidation = { valid: boolean; diagnostics: string[] }

/** Whole-board gate independent of search completion: continuous copper
 * clearances, widths, drill spacing, edge clearance and physical connectivity.
 * Unsupported SRJ geometry throws rather than being silently approximated. */
export function validatePostRoutingCandidate(
  srj: PostRoutingPhysicalInput,
  traces: SimplifiedPcbTrace[],
  traceOwners: ReadonlyMap<string, string>,
): PostRoutingValidation {
  if (srj.connections.length === 0)
    throw new Error("Post-routing validation requires nets")
  const diagnostics: string[] = []
  const names = new Set(srj.connections.map((c) => c.name))
  if (names.size !== srj.connections.length)
    throw new Error("Duplicate input net identity")
  const ids = new Set<string>()
  for (const trace of traces) {
    if (ids.has(trace.pcb_trace_id))
      diagnostics.push(`Duplicate trace ${trace.pcb_trace_id}`)
    ids.add(trace.pcb_trace_id)
    if (!names.has(traceOwners.get(trace.connection_name)!))
      throw new Error(`Unresolved trace owner ${trace.connection_name}`)
    if (trace.route.length < 2)
      diagnostics.push(`Empty trace ${trace.pcb_trace_id}`)
    const connection = srj.connections.find(
      (c) => c.name === traceOwners.get(trace.connection_name),
    )!
    const width = Math.max(
      srj.minTraceWidth,
      connection.nominalTraceWidth ??
        connection.width ??
        srj.nominalTraceWidth ??
        srj.minTraceWidth,
    )
    if (!Number.isFinite(width) || width <= 0)
      throw new Error(`Invalid net width ${connection.name}`)
    for (let i = 0; i < trace.route.length; i++) {
      const p = trace.route[i]!,
        previous = trace.route[i - 1],
        next = trace.route[i + 1]
      if (p.route_type !== "wire" && p.route_type !== "via")
        throw new Error(`Unsupported trace primitive ${p.route_type}`)
      if (![p.x, p.y].every(Number.isFinite))
        throw new Error(`Non-finite trace ${trace.pcb_trace_id}`)
      if (p.route_type === "wire") {
        if (p.layer !== "top" && p.layer !== "bottom")
          throw new Error(`Unsupported wire layer ${p.layer}`)
        if (!Number.isFinite(p.width) || p.width < width - 1e-9)
          diagnostics.push(`Trace width ${trace.pcb_trace_id}:${i}`)
        if (next?.route_type === "wire" && next.layer !== p.layer)
          diagnostics.push(
            `Missing layer-transition via ${trace.pcb_trace_id}:${i}`,
          )
      } else {
        const diameter =
          p.via_diameter ??
          srj.minViaPadDiameter ??
          srj.min_via_pad_diameter ??
          srj.minViaDiameter ??
          0.6
        const hole =
          p.via_hole_diameter ??
          srj.minViaHoleDiameter ??
          srj.min_via_hole_diameter ??
          0.3
        const requiredDiameter =
          srj.minViaPadDiameter ??
          srj.min_via_pad_diameter ??
          srj.minViaDiameter ??
          0.6
        const requiredHole =
          srj.minViaHoleDiameter ?? srj.min_via_hole_diameter ?? 0.3
        if (
          ![diameter, hole].every(Number.isFinite) ||
          diameter <= hole ||
          diameter < requiredDiameter - 1e-9 ||
          hole < requiredHole - 1e-9
        )
          diagnostics.push(`Via dimensions ${trace.pcb_trace_id}:${i}`)
        if (
          previous?.route_type !== "wire" ||
          next?.route_type !== "wire" ||
          previous.layer !== p.from_layer ||
          next.layer !== p.to_layer ||
          p.from_layer === p.to_layer ||
          Math.hypot(
            previous.x - p.x,
            previous.y - p.y,
            next.x - p.x,
            next.y - p.y,
          ) > 1e-8 ||
          (p.layers &&
            (p.layers.length !== 2 ||
              !p.layers.includes("top") ||
              !p.layers.includes("bottom")))
        )
          diagnostics.push(
            `Malformed via transition ${trace.pcb_trace_id}:${i}`,
          )
      }
    }
  }
  const problem = createDynamicNetTreeProblem(
    srj,
    srj.connections[0]!.name,
    traces,
    traceOwners,
  )
  const rules = [
    problem.width,
    problem.clearance,
    problem.boardEdgeClearance,
    problem.viaDiameter,
    problem.viaHoleDiameter,
    problem.holeClearance,
    ...Object.values(problem.bounds),
  ]
  if (
    rules.some((n) => !Number.isFinite(n)) ||
    problem.width <= 0 ||
    problem.clearance < 0 ||
    problem.boardEdgeClearance < 0 ||
    problem.holeClearance < 0 ||
    problem.viaHoleDiameter <= 0 ||
    problem.viaDiameter <= problem.viaHoleDiameter ||
    problem.outline.length < 3
  )
    throw new Error("Invalid post-routing physical rules")
  const copper = problem.copper
  for (const c of copper) {
    if (
      ![
        c.start.x,
        c.start.y,
        c.end.x,
        c.end.y,
        c.radius,
        ...(c.rectangle ? Object.values(c.rectangle) : []),
      ].every(Number.isFinite) ||
      c.radius < 0 ||
      (c.rectangle && (c.rectangle.width <= 0 || c.rectangle.height <= 0))
    )
      throw new Error(`Invalid copper ${c.id}`)
    if (c.kind === "pad") continue
    const edge = c.radius + problem.boardEdgeClearance
    if (
      !pointInOutline(c.start, problem.outline) ||
      !pointInOutline(c.end, problem.outline) ||
      problem.outline.some(
        (p, i) =>
          minimumDistanceBetweenSegments(
            c.start,
            c.end,
            p,
            problem.outline[(i + 1) % problem.outline.length]!,
          ) <
          edge - 1e-8,
      )
    )
      diagnostics.push(`Board edge ${c.id}`)
  }
  for (let i = 0; i < copper.length; i++)
    for (let j = 0; j < i; j++) {
      const a = copper[i]!,
        b = copper[j]!
      if (!a.layers.some((z) => b.layers.includes(z))) continue
      if (a.owner !== b.owner) {
        const gap = a.rectangle
          ? Math.min(
              ...copperRectangleCorners(a).map((p, k, corners) =>
                segmentCopperGap(p, corners[(k + 1) % corners.length]!, b),
              ),
            )
          : segmentCopperGap(a.start, a.end, b) - a.radius
        const clearance =
          a.kind === "pad" && b.kind === "pad"
            ? (srj.minPadEdgeToPadEdgeClearance ?? problem.clearance)
            : problem.clearance
        if (gap < clearance - 1e-8)
          diagnostics.push(`Foreign copper clearance ${a.id}/${b.id}`)
      }
      if (a.holeDiameter && b.holeDiameter) {
        const sameSite =
          a.owner === b.owner &&
          Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) < 1e-9 &&
          a.holeDiameter === b.holeDiameter &&
          a.radius === b.radius
        if (
          !sameSite &&
          minimumDistanceBetweenSegments(a.start, a.end, b.start, b.end) <
            (a.holeDiameter + b.holeDiameter) / 2 + problem.holeClearance - 1e-8
        )
          diagnostics.push(`Drill spacing ${a.id}/${b.id}`)
      }
      if (
        !problem.allowViaInPad &&
        ((a.kind === "via" &&
          b.kind === "pad" &&
          segmentCopperGap(a.start, a.end, b) < a.radius - 1e-8) ||
          (b.kind === "via" &&
            a.kind === "pad" &&
            segmentCopperGap(b.start, b.end, a) < b.radius - 1e-8))
      )
        diagnostics.push(`Via in pad ${a.id}/${b.id}`)
    }
  for (const connection of srj.connections) {
    const own = copper.filter((c) => c.owner === connection.name)
    const terminals: TreeCopper[] = connection.pointsToConnect.flatMap((p, i) =>
      (p.layers ?? [p.layer!]).map((layer) => {
        if (
          (layer !== "top" && layer !== "bottom") ||
          ![p.x, p.y].every(Number.isFinite)
        )
          throw new Error(`Invalid terminal ${connection.name}:${i}`)
        return {
          id: `validation:${i}:${layer}`,
          owner: connection.name,
          layers: [layer === "top" ? 0 : 1],
          kind: "terminal" as const,
          start: p,
          end: p,
          radius: 0,
        }
      }),
    )
    if (!terminals.length)
      throw new Error(`No terminals for ${connection.name}`)
    const items = [...own, ...terminals],
      reached = new Set<TreeCopper>([terminals[0]!])
    const queue = [terminals[0]!]
    while (queue.length) {
      const a = queue.pop()!
      for (const b of items)
        if (!reached.has(b) && copperTouches(a, b)) {
          reached.add(b)
          queue.push(b)
        }
    }
    if (items.some((c) => !reached.has(c)))
      diagnostics.push(`Disconnected copper or terminals ${connection.name}`)
  }
  return { valid: diagnostics.length === 0, diagnostics }
}
