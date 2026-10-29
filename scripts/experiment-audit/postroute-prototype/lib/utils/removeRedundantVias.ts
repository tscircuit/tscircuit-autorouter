import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import { getViaDimensions } from "./getViaDimensions"
import { getPowerTraceExpansionConnectionNames } from "../autorouter-pipelines/AutoroutingPipeline7_MultiGraph/getPowerTraceExpansionConnectionNames"

type Point = { x: number; y: number }
type Wire = Extract<SimplifiedPcbTrace["route"][number], { route_type: "wire" }>
type Via = Extract<SimplifiedPcbTrace["route"][number], { route_type: "via" }>
type Disk = Point & { radius: number }
type CopperWire = {
  owner: string
  start: Wire
  end: Wire
  radius: number
  originalIndex: number
  traceIndex: number
  interval: [number, number]
}
type CopperVia = Disk & {
  owner: string
  holeRadius: number
  occurrences: Array<{ traceIndex: number; routeIndex: number }>
}
type OriginalOwners = {
  connections: Map<string, string>
  sourceTraces: Map<string, string>
  terminalReferences: Map<string, Set<string>>
}
export type RedundantViaRemovalResult = {
  traces: SimplifiedPcbTraces
  removedViaSites: number
  removedViaOccurrences: number
  unsupportedReason?: string
}

const EPSILON = 1e-9

function getOutsideIntervals(start: Point, end: Point, disks: Disk[],
  margin: number): Array<[number, number]> {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= EPSILON * EPSILON) return []
  const inside: Array<[number, number]> = []
  for (const disk of disks) {
    const radius = disk.radius + margin
    const x = start.x - disk.x
    const y = start.y - disk.y
    const linear = 2 * (x * dx + y * dy)
    const constant = x * x + y * y - radius * radius
    const discriminant = linear * linear - 4 * lengthSquared * constant
    if (discriminant < 0) continue
    const offset = Math.sqrt(discriminant)
    const lower = Math.max(0, (-linear - offset) / (2 * lengthSquared))
    const upper = Math.min(1, (-linear + offset) / (2 * lengthSquared))
    if (lower <= upper) inside.push([lower, upper])
  }
  inside.sort((a, b) => a[0] - b[0])
  const outside: Array<[number, number]> = []
  let cursor = 0
  for (const [lower, upper] of inside) {
    if (lower > cursor + EPSILON) outside.push([cursor, lower])
    cursor = Math.max(cursor, upper)
  }
  if (cursor < 1 - EPSILON) outside.push([cursor, 1])
  return outside
}

function getWirePiece(wire: CopperWire, interval: [number, number]): CopperWire {
  const dx = wire.end.x - wire.start.x
  const dy = wire.end.y - wire.start.y
  return { ...wire, interval,
    start: { ...wire.start, x: wire.start.x + dx * interval[0],
      y: wire.start.y + dy * interval[0] },
    end: { ...wire.end, x: wire.start.x + dx * interval[1],
      y: wire.start.y + dy * interval[1] } }
}

function closestPoint(point: Point, start: Point, end: Point): Point {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const denominator = dx * dx + dy * dy
  const fraction = denominator === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator))
  return { x: start.x + fraction * dx, y: start.y + fraction * dy }
}

function segmentDistance(point: Point, start: Point, end: Point): number {
  const closest = closestPoint(point, start, end)
  const dx = closest.x - point.x
  const dy = closest.y - point.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  return distance
}

function getContactWitness(first: CopperWire, second: CopperWire): Point | null {
  const ax = first.end.x - first.start.x
  const ay = first.end.y - first.start.y
  const bx = second.end.x - second.start.x
  const by = second.end.y - second.start.y
  const denominator = ax * by - ay * bx
  if (denominator !== 0) {
    const dx = second.start.x - first.start.x
    const dy = second.start.y - first.start.y
    const t = (dx * by - dy * bx) / denominator
    const u = (dx * ay - dy * ax) / denominator
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return { x: first.start.x + t * ax, y: first.start.y + t * ay }
    }
  }
  const candidates: Array<[Point, Point]> = [
    [first.start, closestPoint(first.start, second.start, second.end)],
    [first.end, closestPoint(first.end, second.start, second.end)],
    [closestPoint(second.start, first.start, first.end), second.start],
    [closestPoint(second.end, first.start, first.end), second.end],
  ]
  candidates.sort((a, b) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y)
    - Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y))
  const [start, end] = candidates[0]
  if (Math.hypot(start.x - end.x, start.y - end.y)
    >= first.radius + second.radius - EPSILON) return null
  const fraction = first.radius / (first.radius + second.radius)
  return { x: start.x + fraction * (end.x - start.x),
    y: start.y + fraction * (end.y - start.y) }
}

function getOriginalOwners(input: SimpleRouteJson): OriginalOwners {
  const parents = new Map<string, string>()
  function root(key: string): string {
    const parent = parents.get(key)
    if (parent === undefined) {
      parents.set(key, key)
      return key
    }
    if (parent === key) return key
    const representative = root(parent)
    parents.set(key, representative)
    return representative
  }
  for (const connection of input.connections) {
    const declarations = [
      JSON.stringify(["connection-name", connection.name]),
      ...(connection.source_trace_id === undefined ? [] : [
        JSON.stringify(["source-trace", connection.source_trace_id]),
      ]),
      ...connection.pointsToConnect.flatMap((point) => [
        ...(point.pcb_port_id === undefined ? [] : [
          JSON.stringify(["pcb-port", point.pcb_port_id]),
        ]),
        ...(point.pointId === undefined ? [] : [
          JSON.stringify(["point-id", point.pointId]),
        ]),
      ]),
    ]
    const representative = root(declarations[0])
    for (const declaration of declarations.slice(1)) {
      parents.set(root(declaration), representative)
    }
  }
  const owners: OriginalOwners = { connections: new Map(), sourceTraces: new Map(),
    terminalReferences: new Map() }
  for (const connection of input.connections) {
    const owner = root(JSON.stringify(["connection-name", connection.name]))
    owners.connections.set(connection.name, owner)
    if (connection.source_trace_id !== undefined) owners.sourceTraces.set(connection.source_trace_id, owner)
    for (const point of connection.pointsToConnect) {
      for (const reference of [point.pcb_port_id, point.pointId]) {
        if (reference === undefined) continue
        const entries = owners.terminalReferences.get(reference)
        if (entries === undefined) owners.terminalReferences.set(reference, new Set([owner]))
        else entries.add(owner)
      }
    }
  }
  return owners
}

function remainsConnected(adjacency: Array<Set<number>>, removed: Set<number>,
  candidate: number): boolean {
  const neighbors = [...adjacency[candidate]].filter((node) => !removed.has(node))
  if (neighbors.length < 2) return false
  const visited = new Set<number>([neighbors[0]])
  const pending = [neighbors[0]]
  while (pending.length > 0) {
    const current = pending.pop()!
    for (const neighbor of adjacency[current]) {
      if (neighbor !== candidate && !removed.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor)
        pending.push(neighbor)
      }
    }
  }
  return neighbors.every((neighbor) => visited.has(neighbor))
}

/**
 * Experimental, deliberately conservative postroute reduction. It adds no
 * centerline or width and preserves every existing wire record. Unsupported
 * inputs are selected out before mutation; malformed route state throws.
 *
 * A via is deleted only when all its copper neighbors remain connected without
 * the entire manufactured site. Original pad/terminal contacts are protected,
 * and drilling is included in the alternate-path certificate.
 */
export function removeRedundantVias(input: SimpleRouteJson,
  traces: SimplifiedPcbTraces): RedundantViaRemovalResult {
  const unchanged = { traces, removedViaSites: 0, removedViaOccurrences: 0 }
  if (!Number.isInteger(input.layerCount) || input.layerCount < 2) {
    throw new Error("Via reduction requires a declared manufactured layer stack")
  }
  const layers = new Set(["top", ...Array.from({ length: input.layerCount - 2 },
    (_, index) => `inner${index + 1}`), "bottom"])
  if (input.obstacles.some((obstacle) => !Number.isFinite(obstacle.width)
    || !Number.isFinite(obstacle.height) || obstacle.width <= 0 || obstacle.height <= 0
    || !Number.isFinite(obstacle.center.x) || !Number.isFinite(obstacle.center.y))) {
    throw new Error("Invalid original obstacle geometry in via reduction")
  }
  if (input.traces?.length || input.differentialPairs?.length || input.buses?.length
    || input.jumpers?.length || input.allowBlindAndBuriedVias
    || getPowerTraceExpansionConnectionNames(input).length > 0) {
    return { ...unchanged, unsupportedReason: "preloads or configured routing policy" }
  }
  if (traces.some((trace) => trace.__replaces_pcb_trace_id !== undefined
    || trace.route.some((point) => point.route_type !== "wire" && point.route_type !== "via"))) {
    return { ...unchanged, unsupportedReason: "non-wire/via output or replacement" }
  }
  const owners = getOriginalOwners(input)
  if (new Set(input.connections.map((connection) => connection.name)).size !== input.connections.length) {
    return { ...unchanged, unsupportedReason: "ambiguous original connection names" }
  }
  if (traces.some((trace) => !owners.connections.has(trace.connection_name))) {
    return { ...unchanged, unsupportedReason: "output has no exact original connection declaration" }
  }
  if (traces.some((trace) => {
    const owner = owners.connections.get(trace.connection_name)!
    if ("source_trace_id" in trace && (typeof trace.source_trace_id !== "string"
      || owners.sourceTraces.get(trace.source_trace_id) !== owner)) return true
    return trace.connectsTo?.some((reference) => {
      const declared = owners.terminalReferences.get(reference)
      return declared !== undefined && (declared.size !== 1 || !declared.has(owner))
    }) === true
  })) return { ...unchanged, unsupportedReason: "conflicting original trace ownership" }
  const uniqueIds = new Set(traces.map((trace) => trace.pcb_trace_id))
  if (uniqueIds.size !== traces.length) throw new Error("Duplicate trace identity in via reduction")
  const defaultVia = getViaDimensions(input)
  const wires: CopperWire[] = []
  const vias: CopperVia[] = []
  const viaBySite = new Map<string, CopperVia>()
  const firstTraceByConnection = new Map<string, number>()
  for (const [traceIndex, trace] of traces.entries()) {
    if (!firstTraceByConnection.has(trace.connection_name)) {
      firstTraceByConnection.set(trace.connection_name, traceIndex)
    }
    const owner = owners.connections.get(trace.connection_name)!
    for (const [routeIndex, point] of trace.route.entries()) {
      if (point.route_type !== "wire" && point.route_type !== "via") {
        throw new Error("Unexpected route type after via reduction qualification")
      }
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new Error("Non-finite route coordinate in via reduction")
      }
      if (point.route_type === "wire") {
        if (!Number.isFinite(point.width) || point.width <= 0 || !layers.has(point.layer)) {
          throw new Error("Invalid wire width in via reduction")
        }
        const next = trace.route[routeIndex + 1]
        if (next?.route_type === "wire") {
          if (point.layer !== next.layer) throw new Error("Wire layer jump in via reduction input")
          if (point.width !== next.width) {
            return { ...unchanged, unsupportedReason: "variable-width segment" }
          }
          wires.push({ owner, start: point, end: next, radius: point.width / 2,
            originalIndex: wires.length, traceIndex, interval: [0, 1] })
        }
      } else {
        const previous = trace.route[routeIndex - 1]
        const next = trace.route[routeIndex + 1]
        if (previous?.route_type !== "wire" || next?.route_type !== "wire"
          || !layers.has(point.from_layer) || !layers.has(point.to_layer)
          || previous.x !== point.x || previous.y !== point.y
          || next.x !== point.x || next.y !== point.y
          || previous.layer !== point.from_layer || next.layer !== point.to_layer) {
          throw new Error("Via does not join its neighboring wire endpoints")
        }
        if (point.layers !== undefined || point.from_layer === point.to_layer) {
          return { ...unchanged, unsupportedReason: "explicit via span or zero-layer transition" }
        }
        const radius = (point.via_diameter ?? defaultVia.padDiameter) / 2
        const holeRadius = (point.via_hole_diameter ?? defaultVia.holeDiameter) / 2
        if (!Number.isFinite(radius) || !Number.isFinite(holeRadius)
          || radius <= holeRadius || holeRadius <= 0) {
          throw new Error("Invalid manufactured via dimensions in via reduction")
        }
        const key = JSON.stringify([owner, point.x, point.y, radius, holeRadius, input.layerCount])
        let via = viaBySite.get(key)
        if (via === undefined) {
          via = { owner, x: point.x, y: point.y, radius, holeRadius, occurrences: [] }
          vias.push(via)
          viaBySite.set(key, via)
        }
        via.occurrences.push({ traceIndex, routeIndex })
      }
    }
  }
  const obstacles: Disk[] = input.obstacles.map((obstacle) => ({
    ...obstacle.center, radius: Math.hypot(obstacle.width, obstacle.height) / 2,
  }))
  const drills: Disk[] = vias.map((via) => ({ x: via.x, y: via.y, radius: via.holeRadius }))
  const excludedDisks = [...obstacles, ...drills]
  const pieces = wires.flatMap((wire) => getOutsideIntervals(wire.start, wire.end,
    excludedDisks, wire.radius + EPSILON * 4).map((interval) => getWirePiece(wire, interval)))
  const piecesByWire = new Map<number, number[]>()
  for (const [index, piece] of pieces.entries()) {
    const entries = piecesByWire.get(piece.originalIndex)
    if (entries === undefined) piecesByWire.set(piece.originalIndex, [index])
    else entries.push(index)
  }
  const adjacency = Array.from({ length: pieces.length + vias.length }, () => new Set<number>())
  for (let first = 0; first < pieces.length; first++) {
    const a = pieces[first]
    for (let second = 0; second < first; second++) {
      const b = pieces[second]
      if (a.owner !== b.owner || a.start.layer !== b.start.layer) continue
      const witness = getContactWitness(a, b)
      if (witness === null) continue
      adjacency[first].add(second)
      adjacency[second].add(first)
    }
  }
  const protectedSites = new Set<number>()
  for (const [index, via] of vias.entries()) {
    const node = pieces.length + index
    const intactAnnulus = !obstacles.some((obstacle) => Math.hypot(via.x - obstacle.x, via.y - obstacle.y)
      <= via.radius + obstacle.radius + EPSILON)
      && !vias.some((other) => other !== via && Math.hypot(via.x - other.x, via.y - other.y)
        <= via.radius + other.holeRadius + EPSILON)
    if (!intactAnnulus
      || input.connections.some((connection) => connection.pointsToConnect.some((point) =>
        Math.hypot(via.x - point.x, via.y - point.y) <= via.radius + EPSILON))
      || vias.some((other) => other !== via && Math.hypot(via.x - other.x, via.y - other.y)
        <= via.radius + other.radius + EPSILON)
      || via.occurrences.some(({ traceIndex }) => firstTraceByConnection.get(
        traces[traceIndex].connection_name) === traceIndex)) protectedSites.add(node)
    // Splitting at a deleted via must not create a new dangling endpoint.
    // Require another trace's unchanged copper to contain every new endpoint
    // on its original layer. The deleted drill is filled only by same-owner
    // existing wire copper; foreign copper is protected below.
    if (via.occurrences.some(({ traceIndex, routeIndex }) =>
      [traces[traceIndex].route[routeIndex - 1], traces[traceIndex].route[routeIndex + 1]]
        .some((point) => point.route_type !== "wire" || !wires.some((wire) =>
          wire.traceIndex !== traceIndex && wire.owner === via.owner && wire.start.layer === point.layer
          && segmentDistance(via, wire.start, wire.end) < wire.radius - EPSILON)))) {
      protectedSites.add(node)
    }
    if (!intactAnnulus) continue
    const contactingPieces = new Set<number>()
    for (const [pieceIndex, piece] of pieces.entries()) {
      if (piece.owner !== via.owner || segmentDistance(via, piece.start, piece.end)
        >= via.radius + piece.radius - EPSILON) continue
      contactingPieces.add(pieceIndex)
      adjacency[node].add(pieceIndex)
      adjacency[pieceIndex].add(node)
    }
    for (const [wireIndex, wire] of wires.entries()) {
      const distance = segmentDistance(via, wire.start, wire.end)
      if (distance >= via.radius + wire.radius - EPSILON) continue
      if (wire.owner !== via.owner) {
        protectedSites.add(node)
        continue
      }
      if (Math.max(Math.hypot(via.x - wire.start.x, via.y - wire.start.y),
        Math.hypot(via.x - wire.end.x, via.y - wire.end.y)) + wire.radius
        <= via.holeRadius + EPSILON) continue
      // A drill can cut a narrow wire into two conductive sides. Every side
      // that could touch the annulus needs its own solid-copper witness; a
      // single nearby witness must not stand in for both sides of a hole.
      const innerRadius = Math.max(0, via.holeRadius - wire.radius)
      if (Math.abs(via.holeRadius - wire.radius) <= EPSILON * 16 && distance <= EPSILON * 16
        || innerRadius > 0 && Math.abs(distance - innerRadius) <= EPSILON * 16) {
        protectedSites.add(node)
        continue
      }
      const potentialSides = innerRadius <= EPSILON ? [[0, 1] as [number, number]]
        : getOutsideIntervals(wire.start, wire.end, [{ ...via, radius: innerRadius }], 0)
      for (const side of potentialSides) {
        const part = getWirePiece(wire, side)
        if (segmentDistance(via, part.start, part.end) >= via.radius + wire.radius - EPSILON
          || Math.max(Math.hypot(via.x - part.start.x, via.y - part.start.y),
            Math.hypot(via.x - part.end.x, via.y - part.end.y)) + wire.radius
            <= via.holeRadius + EPSILON) continue
        if (!(piecesByWire.get(wireIndex) ?? []).some((pieceIndex) =>
          contactingPieces.has(pieceIndex) && pieces[pieceIndex].interval[0] < side[1]
          && pieces[pieceIndex].interval[1] > side[0])) protectedSites.add(node)
      }
    }
  }
  const removed = new Set<number>()
  const removedRecords = new Map<number, Set<number>>()
  for (const [index, via] of vias.entries()) {
    const node = pieces.length + index
    if (protectedSites.has(node) || !remainsConnected(adjacency, removed, node)) continue
    const cuts = new Map<number, Set<number>>()
    for (const { traceIndex, routeIndex } of via.occurrences) {
      const traceCuts = new Set(cuts.get(traceIndex) ?? removedRecords.get(traceIndex))
      traceCuts.add(routeIndex)
      cuts.set(traceIndex, traceCuts)
    }
    const hasShortFragment = [...cuts].some(([traceIndex, traceCuts]) => {
      let start = 0
      for (const cut of [...traceCuts].sort((a, b) => a - b)) {
        if (cut - start < 2) return true
        start = cut + 1
      }
      return traces[traceIndex].route.length - start < 2
    })
    if (hasShortFragment) continue
    removed.add(node)
    for (const [traceIndex, traceCuts] of cuts) removedRecords.set(traceIndex, traceCuts)
  }
  if (removed.size === 0) return unchanged
  const declaredTerminalIds = new Set(input.connections.flatMap((connection) =>
    connection.pointsToConnect.flatMap((point) => [point.pcb_port_id, point.pointId]
      .filter((id): id is string => id !== undefined))))
  const output: SimplifiedPcbTraces = []
  for (const [traceIndex, trace] of traces.entries()) {
    const cuts = removedRecords.get(traceIndex)
    if (cuts === undefined) {
      output.push(trace)
      continue
    }
    const boundaries = [...cuts].sort((a, b) => a - b).concat(trace.route.length)
    let start = 0
    for (const [part, end] of boundaries.entries()) {
      let id = part === 0 ? trace.pcb_trace_id : `${trace.pcb_trace_id}__via_reduction_${part}`
      while (part > 0 && uniqueIds.has(id)) id += "_"
      uniqueIds.add(id)
      const route = trace.route.slice(start, end)
      const localPortIds = new Set(route.flatMap((point) => point.route_type === "wire"
        ? [point.start_pcb_port_id, point.end_pcb_port_id].filter((port) => port !== undefined) : []))
      output.push({ ...trace, pcb_trace_id: id, route,
        ...(trace.connectsTo === undefined ? {} : { connectsTo: trace.connectsTo.filter((connection) =>
          !declaredTerminalIds.has(connection) || localPortIds.has(connection)) }) })
      start = end + 1
    }
  }
  return { traces: output, removedViaSites: removed.size,
    removedViaOccurrences: [...removedRecords.values()].reduce((sum, records) => sum + records.size, 0) }
}
