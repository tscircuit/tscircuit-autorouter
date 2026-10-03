import type { SimplifiedPcbTrace } from "../../types"
import { UnsupportedPostRoutingInputError } from "./UnsupportedPostRoutingInputError"
import { getViaDimensions } from "../../utils/getViaDimensions"
import {
  postRoutingLayerIndex,
  postRoutingViaLayers,
} from "../DynamicNetTreeSolver/postRoutingLayers"
import { minimumDistanceBetweenSegments } from "../../utils/minimumDistanceBetweenSegments"
import {
  createDynamicNetTreeProblem,
  type PostRoutingPhysicalInput,
} from "../DynamicNetTreeSolver/createDynamicNetTreeProblem"
import {
  copperGap,
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
  const viaDimensions = getViaDimensions(srj)
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
      if (p.route_type === "through_obstacle") {
        postRoutingLayerIndex(p.from_layer, srj.layerCount)
        postRoutingLayerIndex(p.to_layer, srj.layerCount)
        if (
          ![p.start.x, p.start.y, p.end.x, p.end.y, p.width].every(
            Number.isFinite,
          )
        )
          throw new Error(
            `Non-finite plated traversal ${trace.pcb_trace_id}:${i}`,
          )
        if (
          p.width < width - 1e-9 ||
          previous?.route_type !== "wire" ||
          next?.route_type !== "wire" ||
          previous.layer !== p.from_layer ||
          next.layer !== p.to_layer ||
          Math.hypot(
            previous.x - p.start.x,
            previous.y - p.start.y,
            next.x - p.end.x,
            next.y - p.end.y,
          ) > 1e-8
        )
          diagnostics.push(
            `Malformed plated traversal ${trace.pcb_trace_id}:${i}`,
          )
        continue
      }
      if (p.route_type !== "wire" && p.route_type !== "via")
        throw new UnsupportedPostRoutingInputError(
          `Unsupported trace primitive ${p.route_type}`,
        )
      if (![p.x, p.y].every(Number.isFinite))
        throw new Error(`Non-finite trace ${trace.pcb_trace_id}`)
      if (p.route_type === "wire") {
        postRoutingLayerIndex(p.layer, srj.layerCount)
        if (!Number.isFinite(p.width) || p.width < width - 1e-9)
          diagnostics.push(`Trace width ${trace.pcb_trace_id}:${i}`)
        if (next?.route_type === "wire" && next.layer !== p.layer)
          diagnostics.push(
            `Missing layer-transition via ${trace.pcb_trace_id}:${i}`,
          )
      } else {
        const diameter = p.via_diameter ?? viaDimensions.padDiameter
        const hole = p.via_hole_diameter ?? viaDimensions.holeDiameter
        const requiredDiameter = viaDimensions.padDiameter
        const requiredHole = viaDimensions.holeDiameter
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
          ) > 1e-8
        )
          diagnostics.push(
            `Malformed via transition ${trace.pcb_trace_id}:${i}`,
          )
        postRoutingViaLayers(srj, p)
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
    problem.viaToPadClearance!,
    problem.traceToHoleClearance!,
    problem.platedHoleClearance!,
    srj.minPadEdgeToPadEdgeClearance ?? 0,
    ...Object.values(problem.bounds),
  ]
  if (
    rules.some((n) => !Number.isFinite(n)) ||
    problem.width <= 0 ||
    problem.clearance < 0 ||
    problem.boardEdgeClearance < 0 ||
    problem.holeClearance < 0 ||
    problem.viaToPadClearance! < 0 ||
    problem.traceToHoleClearance! < 0 ||
    problem.platedHoleClearance! < 0 ||
    (srj.minPadEdgeToPadEdgeClearance ?? 0) < 0 ||
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
        ...(c.routingEnvelope ? Object.values(c.routingEnvelope) : []),
        ...(c.drill
          ? [
              c.drill.start.x,
              c.drill.start.y,
              c.drill.end.x,
              c.drill.end.y,
              c.drill.diameter,
            ]
          : []),
      ].every(Number.isFinite) ||
      c.radius < 0 ||
      (c.routingEnvelope &&
        (c.routingEnvelope.width <= 0 || c.routingEnvelope.height <= 0)) ||
      (c.drill &&
        (c.drill.diameter <= 0 ||
          c.drill.layers.length === 0 ||
          c.drill.layers.some(
            (z) => !Number.isInteger(z) || z < 0 || z >= srj.layerCount,
          ))) ||
      (c.rectangle &&
        (c.rectangle.width < 0 ||
          c.rectangle.height < 0 ||
          (c.radius === 0 &&
            (c.rectangle.width === 0 || c.rectangle.height === 0))))
    )
      throw new Error(`Invalid copper ${c.id}`)
    if (c.kind === "pad" || c.kind === "hole") continue
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
      const copperOverlap = a.layers.some((z) => b.layers.includes(z))
      if (copperOverlap && a.owner !== b.owner) {
        const gap = copperGap(a, b)
        const clearance =
          a.kind === "hole" || b.kind === "hole"
            ? a.kind === "wire" || b.kind === "wire"
              ? problem.traceToHoleClearance!
              : 0
            : a.kind === "pad" && b.kind === "pad"
              ? (srj.minPadEdgeToPadEdgeClearance ?? 0)
              : (a.kind === "via" && b.kind === "pad") ||
                  (b.kind === "via" && a.kind === "pad")
                ? problem.viaToPadClearance!
                : problem.clearance
        if (gap < clearance - 1e-8 || (clearance === 0 && copperTouches(a, b)))
          diagnostics.push(`Foreign copper clearance ${a.id}/${b.id}`)
      }
      const ad = a.drill,
        bd = b.drill
      if (ad && bd && ad.layers.some((z) => bd.layers.includes(z))) {
        const sameSite =
          a.owner === b.owner &&
          Math.hypot(
            ad.start.x - bd.start.x,
            ad.start.y - bd.start.y,
            ad.end.x - bd.end.x,
            ad.end.y - bd.end.y,
          ) < 1e-9 &&
          ad.diameter === bd.diameter &&
          a.radius === b.radius &&
          JSON.stringify(ad.layers) === JSON.stringify(bd.layers)
        if (
          !sameSite &&
          minimumDistanceBetweenSegments(ad.start, ad.end, bd.start, bd.end) <
            (ad.diameter + bd.diameter) / 2 +
              (a.kind === "via" && b.kind === "via"
                ? problem.holeClearance
                : problem.platedHoleClearance!) -
              1e-8
        )
          diagnostics.push(`Drill spacing ${a.id}/${b.id}`)
      }
      if (
        copperOverlap &&
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
        if (![p.x, p.y].every(Number.isFinite))
          throw new Error(`Invalid terminal ${connection.name}:${i}`)
        return {
          id: `validation:${i}:${layer}`,
          owner: connection.name,
          layers: [postRoutingLayerIndex(layer, srj.layerCount)],
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
