import { shortenPairedFanoutTrees } from "./shortenPairedFanoutTrees"
import { getPinRowEscapeCandidates } from "./getPinRowEscapeCandidates"
import { type ClearancePathInput, findClearancePath } from "@tscircuit/repair04"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { createPipeline9AutoroutingDrcEvaluator } from "./createPipeline9AutoroutingDrcEvaluator"
import { getPipeline9DrcErrorTraceIds } from "./pipeline9JointDrcRepairUtils"

type Trace = SimplifiedPcbTrace
type Wire = Extract<Trace["route"][number], { route_type: "wire" }>
type XY = { x: number; y: number }
type Span = [number, number]
type Evaluate = ReturnType<typeof createPipeline9AutoroutingDrcEvaluator>
type Report = ReturnType<Evaluate>

function canReplaceTrace(input: SimpleRouteJson, trace: Trace): boolean {
  if (trace.isFixed || trace.__replaces_pcb_trace_id) return false
  const connection = input.connections.find((c) => c.name === trace.connection_name)
  if (input.obstacles.some((o) => o.isCopperPour && o.connectedTo.includes(trace.connection_name))) return false
  if (!connection || connection.path || connection.isOffBoard) return false
  const first = trace.route[0]
  const last = trace.route.at(-1)
  if (first?.route_type !== "wire" || last?.route_type !== "wire") return false
  const { padDiameter, holeDiameter } = getViaDimensions(input)
  if (trace.route.some((point) => point.route_type === "via" && (
    (point.via_diameter !== undefined && point.via_diameter !== padDiameter) ||
    (point.via_hole_diameter !== undefined && point.via_hole_diameter !== holeDiameter)
  ))) return false
  return [first, last].every((end) => connection.pointsToConnect.some((port) =>
    port.x === end.x && port.y === end.y &&
    (port.layer === end.layer || port.layers?.includes(end.layer)) &&
    !("terminalVia" in port && port.terminalVia),
  )) && trace.route.every((p) =>
    p.route_type === "via" || (p.route_type === "wire" && p.width === first.width),
  )
}

function cost(trace: Trace): { length: number; vias: number } {
  let length = 0
  let vias = 0
  let previous: XY | undefined
  for (const p of trace.route) {
    if (p.route_type !== "wire" && p.route_type !== "via") throw new Error("Expected uniform wire/via route")
    if (previous) length += Math.hypot(p.x - previous.x, p.y - previous.y)
    if (p.route_type === "via") vias++
    previous = p
  }
  return { length, vias }
}

function improvesCopper(before: Report, after: Report): boolean {
  if (after.errors.length >= before.errors.length) return false
  // Preserve individual continuity findings even when a plane cannot be reconstructed.
  const key = (error: Record<string, unknown>): string => {
    const center = error.center as XY | undefined
    const id = String(error.pcb_trace_error_id ?? "")
    if (/^(missing_connection_|missing_layer_connection_|disconnected_endpoint_|misaligned_via_)/.test(id)) return id
    // Removing a via renumbers later vias in Circuit JSON. Use the physical
    // location and the measured violation for unchanged copper findings.
    return JSON.stringify([error.type,center?.x,center?.y,error.message])
  }
  const available = new Map<string, number>()
  for (const error of before.errorsWithCenters) {
    const id = key(error)
    available.set(id, (available.get(id) ?? 0) + 1)
  }
  for (const error of after.errorsWithCenters) {
    const id = key(error)
    const count = available.get(id) ?? 0
    if (count === 0) return false
    available.set(id, count - 1)
  }
  return true
}

export function repairPipeline9CopperClearance(
  input: SimpleRouteJson,
  pointPairs: SimpleRouteJson,
  traces: Trace[],
): Trace[] {
  const clearance = input.minTraceToPadEdgeClearance
  if (
    !clearance ||
    !input.obstacles.some((pad) => pad.isCopperPour) ||
    input.obstacles.some((pad) => pad.isCopperPour && pad.layers.some((layer) => !layer.startsWith("inner"))) ||
    input.buses?.length ||
    input.differentialPairs?.length ||
    input.jumpers?.length
  ) return traces
  // repair04 accepts uniform copper, not through-obstacle segments or physical jumpers.
  if ([...(input.traces ?? []), ...traces].some((t) => t.route.some((p) => p.route_type !== "wire" && p.route_type !== "via"))) return traces
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input, srjWithPointPairs: pointPairs, includeBoardClearance: true,
    drcOptions: { traceClearance: clearance, viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance },
  })
  let current = traces
  let report = evaluate(current)
  const { padDiameter, holeDiameter } = getViaDimensions(input)
  const blockedLayers = new Set(
    input.obstacles.filter((o) => o.isCopperPour).flatMap((o) =>
      o.layers.map((layer) => mapLayerNameToZ(layer, input.layerCount)),
    ),
  )
  const barriers = input.obstacles.filter((o) => !o.isCopperPour)
  const budget = { searches: 0, nodes: 0 }
  const search = (
    trace: Trace, first: Wire, last: Wire, fixed: Trace[], allowVias: boolean, reverse = false,
  ): Trace["route"] | undefined => {
    const remaining = 600_000 - budget.nodes
    if (++budget.searches > 160 || remaining <= 0) return
    const start = { x: first.x, y: first.y, z: mapLayerNameToZ(first.layer, input.layerCount) }
    const end = { x: last.x, y: last.y, z: mapLayerNameToZ(last.layer, input.layerCount) }
    const margin = Math.max(2, 3 * padDiameter, 12 * input.minTraceWidth)
    const stats = { nodesPopped: 0, completionReason: "no-path" as const }
    const points = findClearancePath({
      srj: {
        ...input,
        obstacles: barriers,
        traces: [...(input.traces ?? []), ...fixed] as ClearancePathInput["srj"]["traces"],
      },
      routes: [{
        connectionName: trace.connection_name,
        rootConnectionName: trace.connection_name,
        traceThickness: first.width,
        viaDiameter: padDiameter,
        route: [start, end],
        vias: [],
      }],
      routeIndex: 0,
      start: reverse ? end : start,
      end: reverse ? start : end,
      bounds: {
        minX: Math.max(input.bounds.minX, Math.min(first.x, last.x) - margin),
        maxX: Math.min(input.bounds.maxX, Math.max(first.x, last.x) + margin),
        minY: Math.max(input.bounds.minY, Math.min(first.y, last.y) - margin),
        maxY: Math.min(input.bounds.maxY, Math.max(first.y, last.y) + margin),
      },
      allowLayerChanges: allowVias,
      traceThickness: first.width,
      traceClearance: clearance + 0.002,
      viaClearance: Math.max(clearance, input.minViaHoleEdgeToViaHoleEdgeClearance ?? 0) + 0.002,
      viaHoleDiameter: holeDiameter,
      gridSize: Math.min(0.1, first.width),
      heuristicWeight: 2,
      maxNodes: Math.min(55_000, remaining),
      stats,
      // An inner pour is repoured around foreign barrels. Keep planar runs on signal layers.
      getAdditionalEdgeCost: (a, b) => a.z === b.z && blockedLayers.has(a.z) ? Infinity : 0,
    })
    budget.nodes += stats.nodesPopped
    if (!points) return
    if (reverse) points.reverse()
    const result: Trace["route"] = [first]
    for (let i = 1; i < points.length; i++) {
      const point = points[i]!
      const previous = points[i - 1]!
      const layer = mapZToLayerName(point.z, input.layerCount)
      if (previous.z !== point.z) {
        result.push({
          route_type: "via",
          x: point.x,
          y: point.y,
          from_layer: mapZToLayerName(previous.z, input.layerCount),
          to_layer: layer,
          via_diameter: padDiameter,
          via_hole_diameter: holeDiameter,
        })
      }
      result.push({ route_type: "wire", x: point.x, y: point.y, layer, width: first.width })
    }
    result[result.length - 1] = last
    return result
  }

  const dirtyTraceIds = (): string[] => {
    const viaOwners = new Map(report.circuitJson.flatMap((e) =>
      e.type === "pcb_via" && e.pcb_trace_id ? [[e.pcb_via_id, e.pcb_trace_id] as const] : [],
    ))
    const ids = report.locationAwareErrors
      .filter((e) => !String(e.pcb_trace_error_id).startsWith("missing_connection_"))
      .flatMap((error) => [
        ...getPipeline9DrcErrorTraceIds(error),
        ...(Array.isArray(error.pcb_via_ids)
          ? error.pcb_via_ids.flatMap((id: string) => viaOwners.get(id) ?? [])
          : []),
      ])
    return [...new Set(ids)]
  }
  const accept = (candidate: Trace[]): boolean => {
    for (const [index, trace] of candidate.entries()) {
      if (trace === current[index]) continue
      const before = cost(current[index]!)
      const after = cost(trace)
      if (after.vias > before.vias || after.length > before.length + 1e-6) return false
    }
    const result = evaluate(candidate)
    if (!improvesCopper(report, result)) return false
    current = candidate
    report = result
    return true
  }

  for (let sweep = 0; sweep < 5; sweep++) {
    const previous = current
    for (const id of dirtyTraceIds()) {
      const trace = current.find((t) => t.pcb_trace_id === id)
      if (!trace || !canReplaceTrace(input, trace)) continue
      const wireRuns: Span[] = []
      let start = 0
      for (let i = 0; i <= trace.route.length; i++) {
        if (trace.route[i]?.route_type === "wire") continue
        if (i - start >= 2) wireRuns.push([start, i - 1])
        start = i + 1
      }
      wireRuns.sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
      const spans: Span[] = [[0, trace.route.length - 1], ...wireRuns]
      let accepted = false
      for (const [lo, hi] of spans) {
        const first = trace.route[lo], last = trace.route[hi]
        if (first?.route_type !== "wire" || last?.route_type !== "wire") continue
        const allowVias = lo === 0 && hi === trace.route.length - 1 && trace.route.some((p) => p.route_type === "via")
        for (const reverse of [false, true]) {
          const replacement = search(trace, first, last, current.filter((t) => t !== trace), allowVias, reverse)
          if (!replacement) continue
          const candidate = {
            ...trace,
            route: [...trace.route.slice(0, lo), ...replacement, ...trace.route.slice(hi + 1)],
          }
          accepted = accept(current.map((t) => t === trace ? candidate : t))
          if (accepted) break
        }
        if (accepted) break
      }
    }
    if (current !== previous) continue
    for (const id of dirtyTraceIds()) {
      const target = current.find((t) => t.pcb_trace_id === id)
      if (!target) continue
      const candidates = getPinRowEscapeCandidates(
        input, current, target, (t) => canReplaceTrace(input, t), search,
      )
      for (const candidate of candidates) {
        if (accept(candidate)) break
      }
      if (current !== previous) break
    }
    if (current === previous) break
  }
  return shortenPairedFanoutTrees(input, current, evaluate)
}
