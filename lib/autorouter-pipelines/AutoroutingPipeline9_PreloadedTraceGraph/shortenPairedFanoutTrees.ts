import { findClearancePath } from "@tscircuit/repair04"
import type { ClearancePathInput } from "@tscircuit/repair04"
import type { ConnectionPoint, Obstacle, SimpleRouteConnection, SimpleRouteJson, SimplifiedPcbTrace as Trace } from "lib/types"
import { combinePreloadedAndRoutedTraces } from "lib/utils/combinePreloadedAndRoutedTraces"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { Pipeline9AutoroutingDrcEvaluator } from "./createPipeline9AutoroutingDrcEvaluator"

type XY = { x: number; y: number }
type Wire = Extract<Trace["route"][number], { route_type: "wire" }>
type Via = Extract<Trace["route"][number], { route_type: "via" }>
type Pin = { port: string; pad: Obstacle; wire: Wire }
type Tree = { pins: Pin[]; traces: Trace[]; connection: SimpleRouteConnection }
type Fan = { source: Pin; receiver: Pin; load: Pin; tree: Tree; distance: number }
type Search = (trace: Trace, start: Wire, end: Wire, fixed: Trace[], grid: number) => Wire[] | undefined
const distance = (a: XY, b: XY): number => Math.hypot(a.x - b.x, a.y - b.y)
const length = (route: XY[]): number => route.slice(1).reduce((sum, p, i) => sum + distance(p, route[i]!), 0)

function findPad(input: SimpleRouteJson, point: ConnectionPoint): Pin | undefined {
  if (!point.pointId || !point.layer || ("terminalVia" in point && point.terminalVia)) return
  const pad = input.obstacles.find((o) => o.componentId && o.layers.length === 1 &&
    o.layers[0] === point.layer && o.center.x === point.x && o.center.y === point.y &&
    o.connectedTo.includes(point.pointId!) && !o.ccwRotationDegrees && !o.shape)
  if (!pad) return
  return { port: point.pointId, pad, wire: {
    route_type: "wire", layer: point.layer, x: point.x, y: point.y, width: input.minTraceWidth,
  } }
}

function collectTrees(input: SimpleRouteJson, traces: Trace[]): Tree[] {
  const trees: Tree[] = []
  for (const connection of input.connections) {
    if (connection.path || connection.isOffBoard || connection.pointsToConnect.length !== 3 ||
      (input.traces ?? []).some((t) => t.connection_name === connection.name)) continue
    const lines = traces.filter((t) => t.connection_name === connection.name)
    if (lines.length !== 2 || lines.some((t) => t.isFixed || t.__replaces_pcb_trace_id)) continue
    const pins = connection.pointsToConnect.flatMap((p) => findPad(input, p) ?? [])
    if (pins.length !== 3 || new Set(pins.map((p) => p.pad.componentId)).size !== 3) continue
    const width = connection.nominalTraceWidth ?? connection.width ?? input.minTraceWidth
    const layer = pins[0]!.wire.layer
    if (pins.some((p) => p.wire.layer !== layer) || lines.some((t) =>
      !t.route.length || !t.route.every((p) => p.route_type === "wire" && p.layer === layer && p.width === width) ||
      ![t.route[0],t.route.at(-1)].every((end) =>
        end?.route_type === "wire" && pins.some((p) => distance(p.wire,end) < 1e-8)))) continue
    for (const pin of pins) pin.wire.width = width
    trees.push({ pins, traces: lines, connection })
  }
  return trees
}

function describeFan(tree: Tree, sourceComponent: string, receiverComponent: string): Fan | undefined {
  const source = tree.pins.find((p) => p.pad.componentId === sourceComponent)!
  const receiver = tree.pins.find((p) => p.pad.componentId === receiverComponent)!
  const load = tree.pins.find((p) => p !== source && p !== receiver)!
  const distances = tree.traces.map((t) => {
    const route = t.route as Wire[]
    return { ends: [route[0]!,route.at(-1)!], length: length(route) }
  })
  const contains = (ends: Wire[], p: Pin): boolean => ends.some((w) => distance(w,p.wire) < 1e-8)
  if (!tree.pins.every((p) => distances.some((d) => contains(d.ends,p)))) return
  const direct = distances.find((d) => contains(d.ends,source) && contains(d.ends,receiver))
  return { tree, source, receiver, load, distance: direct?.length ?? distances[0]!.length + distances[1]!.length }
}

function searchLocal(input: SimpleRouteJson, budget: { nodes: number }): Search {
  return (trace, start, end, fixed, grid) => {
    if (budget.nodes <= 0) return
    const { padDiameter, holeDiameter } = getViaDimensions(input)
    const clearance = input.minTraceToPadEdgeClearance!
    const z = mapLayerNameToZ(start.layer, input.layerCount)
    const margin = Math.max(4 * padDiameter, distance(start,end) * 0.7)
    const stats = { nodesPopped: 0, completionReason: "no-path" as const }
    const a = { x: start.x, y: start.y, z }, b = { x: end.x, y: end.y, z }
    const path = findClearancePath({
      srj: { ...input, traces: combinePreloadedAndRoutedTraces(input.traces ?? [],fixed) as ClearancePathInput["srj"]["traces"] },
      start: a, end: b, routeIndex: 0,
      routes: [{ connectionName: trace.connection_name, rootConnectionName: trace.connection_name,
        traceThickness: start.width, viaDiameter: padDiameter, route: [a,b], vias: [] }],
      bounds: {
        minX: Math.max(input.bounds.minX,Math.min(a.x,b.x)-margin), maxX: Math.min(input.bounds.maxX,Math.max(a.x,b.x)+margin),
        minY: Math.max(input.bounds.minY,Math.min(a.y,b.y)-margin), maxY: Math.min(input.bounds.maxY,Math.max(a.y,b.y)+margin),
      },
      traceThickness: start.width, traceClearance: clearance + 0.002, viaClearance: clearance + 0.002,
      viaHoleDiameter: holeDiameter, allowLayerChanges: false, gridSize: grid, heuristicWeight: 1,
      maxNodes: Math.min(65_000,budget.nodes), stats,
    })
    budget.nodes -= stats.nodesPopped
    return path?.map((p) => ({ ...start, x:p.x, y:p.y })) ?? undefined
  }
}

/** Move the surface portion of plane escapes below the pads while preserving their original anchors. */
function shortenPlaneEscapes(input: SimpleRouteJson, fixed: Trace[], fans: Fan[]): Trace[] {
  const pins = fans.flatMap((f) => f.tree.pins.map((p) => p.wire))
  const xs = pins.map((w) => w.x), ys = pins.map((w) => w.y)
  return fixed.map((trace) => {
    if (trace.isFixed || trace.__replaces_pcb_trace_id) return trace
    let route = trace.route
    if (route[0]?.route_type === "via") route = [...route].reverse()
    const first = route[0], anchor = route.at(-1)
    if (first?.route_type !== "wire" || anchor?.route_type !== "via" || anchor.from_layer !== first.layer ||
      !anchor.to_layer.startsWith("inner") || anchor.x < Math.min(...xs) || anchor.x > Math.max(...xs) ||
      anchor.y < Math.min(...ys) || anchor.y > Math.max(...ys)) return trace
    const matchesPour = input.obstacles.some((o) => o.isCopperPour && o.layers.includes(anchor.to_layer) &&
      o.connectedTo.includes(trace.connection_name) && Math.abs(anchor.x-o.center.x) <= o.width/2 &&
      Math.abs(anchor.y-o.center.y) <= o.height/2)
    const pad = input.obstacles.find((o) => o.componentId && distance(o.center,first) < 1e-8 &&
      o.connectedTo.includes(trace.connection_name) && o.layers.includes(first.layer))
    if (!matchesPour || !pad || route.some((w) => w.route_type === "jumper" || w.route_type === "through_obstacle")) return trace
    const index = route.findIndex((w) => w.route_type === "via")
    const old = route[index] as Via
    if (old.to_layer !== anchor.to_layer && old.from_layer !== anchor.to_layer) return trace
    // On fine-pitch pads keep the existing escape wire and the first safe via.
    const inPad = Math.min(pad.width,pad.height) + input.minTraceToPadEdgeClearance! >= (anchor.via_diameter ?? getViaDimensions(input).padDiameter)
    const via = { ...old, from_layer: first.layer, to_layer: anchor.to_layer,
      x: inPad ? first.x : old.x, y: inPad ? first.y : old.y }
    const top = inPad ? [first] : route.slice(0,index)
    if (!top.every((w) => w.route_type === "wire" && w.layer === first.layer)) return trace
    const inner: Wire = { ...first, layer: anchor.to_layer, x: via.x, y: via.y }
    return { ...trace, route: [...top,via,inner,{ ...inner, x: anchor.x, y: anchor.y }] }
  })
}

function* layerCrossings(input: SimpleRouteJson, fixed: Trace[], f: Fan, g: Fan): Generator<Trace[]> {
  yield fixed
  const pitch = distance(f.source.wire,g.source.wire)
  const { padDiameter, holeDiameter } = getViaDimensions(input)
  const clearance = input.minTraceToPadEdgeClearance!
  for (const conn of input.connections) {
    if (conn.pointsToConnect.length !== 2 || conn.path || conn.isOffBoard) continue
    const pins = conn.pointsToConnect.flatMap((p) => findPad(input,p) ?? [])
    const pin = pins.find((p) => p.pad.componentId === f.source.pad.componentId &&
      Math.min(distance(p.wire,f.source.wire),distance(p.wire,g.source.wire)) < pitch*1.1)
    const other = pins.find((p) => p !== pin)
    if (!pin || !other || other.wire.layer !== pin.wire.layer || distance(pin.wire,other.wire) > distance(f.source.wire,f.receiver.wire)) continue
    const lines = fixed.filter((t) => t.connection_name === conn.name)
    const t = lines[0]
    if (lines.length !== 1 || !t || t.isFixed || t.__replaces_pcb_trace_id || t.route.length < 2 ||
      !t.route.every((p) => p.route_type === "wire" && p.layer === pin.wire.layer) ||
      !(input.layerCount >= 2 && ["top","bottom"].includes(pin.wire.layer))) continue
    if (input.traces?.some((p) => p.connection_name === conn.name)) continue
    const old = t.route as Wire[]
    if (![pin,other].every((p) => [old[0]!,old.at(-1)!].some((w) => distance(w,p.wire) < 1e-8)) ||
      old.some((w) => w.width !== old[0]!.width)) continue
    const normal = pin.pad.height > pin.pad.width ? "y" : "x", tangent = normal === "x" ? "y" : "x"
    const face = Math.sign(other.wire[normal] - pin.wire[normal])
    const span = Math.max(pin.pad.height,pin.pad.width)/2 + padDiameter/2 + clearance + old[0]!.width/2
    for (const skew of [0,-0.25,0.25]) {
      const start = { ...pin.wire, width: old[0]!.width }, end = { ...other.wire, width: old[0]!.width }
      const site = { ...start, [normal]:start[normal]+face*span, [tangent]:start[tangent]+skew*pitch }
      const layer = start.layer === "top" ? "bottom" : "top"
      const via: Via = { route_type:"via", from_layer:start.layer, to_layer:layer, x: site.x,y: site.y,
        via_diameter:padDiameter, via_hole_diameter:holeDiameter }
      const route: Trace["route"] = [start,site,via,{...site,layer},{...end,layer},
        {...via,x:end.x,y:end.y,from_layer:layer,to_layer:end.layer},end]
      yield fixed.map((line) => line === t ? { ...line,route } : line)
    }
  }
}

function routeTrees(first: Fan, second: Fan, fixed: Trace[], search: Search, clearance: number): Trace[] | undefined {
  const built: Trace[] = []
  const jobs = [
    [first,first.source,first.receiver], [second,second.receiver,second.load],
    [second,second.source,second.receiver], [first,first.source,first.load],
  ] as const
  for (const [fan,start,end] of jobs) {
    const template = fan.tree.traces[built.filter((t) => t.connection_name === fan.tree.connection.name).length]!
    const obstacles = [...fixed,...built]
    const grid = Math.min(start.wire.width,clearance)/3
    let route = search(template,start.wire,end.wire,obstacles,grid)
    if (!route || length(route) > 1.5 * distance(start.wire,end.wire)) {
      for (const refined of [start.wire.width/4,start.wire.width/8]) {
        const alternative = search(template,end.wire,start.wire,obstacles,refined)?.reverse()
        if (alternative && (!route || length(alternative) < length(route))) route = alternative
      }
    }
    if (!route) return
    built.push({ ...template,connectsTo:[start.port,end.port],route })
  }

  // Use one real trunk where the paths leave the same fine-pitch pad. All
  // three branches meet at the exact same point outside the solder land.
  const cap = built[3]!.route as Wire[]
  const source = first.source
  const forkIndex = cap.findIndex((p) =>
    Math.abs(p.x-source.wire.x) > source.pad.width/2 + clearance ||
    Math.abs(p.y-source.wire.y) > source.pad.height/2 + clearance)
  if (forkIndex < 1 || forkIndex >= cap.length-1) return
  const fork = cap[forkIndex]!
  const arm = search(built[0]!,first.receiver.wire,fork,[...fixed,built[1]!,built[2]!],source.wire.width/4)
  if (!arm) return
  const stem = cap.slice(0,forkIndex+1)
  const previousWorst = Math.max(first.distance,second.distance)
  if (Math.max(length(arm)+length(stem),length(built[2]!.route as Wire[]),length(cap)) >= previousWorst * 0.9) return
  const stemId = built[0]!.pcb_trace_id + "_trunk"
  if ([...fixed,...built].some((t) => t.pcb_trace_id === stemId)) return
  return [
    { ...built[0]!,route:arm,connectsTo:[first.receiver.port] },
    built[1]!,built[2]!,
    { ...built[3]!,route:cap.slice(forkIndex).reverse(),connectsTo:[first.load.port] },
    { ...built[0]!,pcb_trace_id:stemId,route:stem,connectsTo:[first.source.port] },
  ]
}

/** Reconsider both trees when two independent MSTs compete for the same pin escape. */
export function shortenPairedFanoutTrees(
  input: SimpleRouteJson, traces: Trace[], evaluate: Pipeline9AutoroutingDrcEvaluator,
): Trace[] {
  if (!input.allowViaInPad || !input.minTraceToPadEdgeClearance) return traces
  const trees = collectTrees(input,traces)
  const budget = { nodes: 650_000 }
  const search = searchLocal(input,budget)
  let initialFindings: Set<string> | undefined
  for (const [i,tree] of trees.entries()) {
    for (const other of trees.slice(i+1)) {
      const shared = tree.pins.filter((p) => other.pins.some((q) => p.pad.componentId === q.pad.componentId))
      if (shared.length !== 2 || shared[0]!.wire.layer !== other.pins[0]!.wire.layer) continue
      // The tighter pair of pins is the escape row; the other pair is the receiver.
      const pitch = (p: Pin): number => distance(p.wire,other.pins.find((q) => p.pad.componentId === q.pad.componentId)!.wire)
      shared.sort((a,b) => pitch(a)-pitch(b))
      const [source,receiver] = shared as [Pin,Pin]
      if (pitch(source) > Math.max(source.pad.width,source.pad.height) || pitch(receiver) <= pitch(source)) continue
      const fans = [tree,other].flatMap((t) => describeFan(t,source.pad.componentId!,receiver.pad.componentId!) ?? [])
      if (fans.length !== 2) continue
      fans.sort((a,b) => b.distance / distance(b.source.wire,b.receiver.wire) - a.distance / distance(a.source.wire,a.receiver.wire))
      const [first,second] = fans as [Fan,Fan]
      if (first.distance < 2 * distance(first.source.wire,first.receiver.wire)) continue
      const fixed = traces.filter((t) => !tree.traces.includes(t) && !other.traces.includes(t))
      const compact = shortenPlaneEscapes(input,fixed,fans)
      for (const context of layerCrossings(input,compact,first,second)) {
        if (budget.nodes <= 0) return traces
        const wires = routeTrees(first,second,context,search,input.minTraceToPadEdgeClearance)
        if (!wires) continue
        // Preserve the original plane-side endpoints. Route the inner stubs
        // around foreign barrels after choosing the neighboring signal vias.
        const candidate = [...context,...wires]
        let complete = true
        for (const [idx,t] of compact.entries()) {
          if (fixed[idx] === t) continue
          const a = t.route.at(-2), b = t.route.at(-1)
          if (a?.route_type !== "wire" || b?.route_type !== "wire") { complete = false; break }
          const stub = search(t,a,b,candidate.filter((v) => v !== t),a.width/2)
          if (!stub) { complete = false; break }
          candidate[idx] = { ...t,route:[...t.route.slice(0,-2),...stub] }
        }
        if (!complete || evaluate(candidate,{includeTraceContinuity:false}).errors.length) continue
        // Plane islands are absent from SRJ. Also preserve each existing
        // continuity finding so a repair cannot trade a clearance for an open.
        const findingKey = (e: Record<string,unknown>): string =>
          JSON.stringify([e.type,e.pcb_trace_error_id,e.message])
        initialFindings ??= new Set(evaluate(traces).errors.map(findingKey))
        if (evaluate(candidate).errors.every((e) => initialFindings!.has(findingKey(e)))) return candidate
      }
    }
  }
  return traces
}
