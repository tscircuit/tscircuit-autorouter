export type Point = { x: number; y: number }
export type Occurrence = { traceIndex: number; pointIndex: number }
export type Move = { occurrences: Occurrence[]; oldXY: Point; newXY: Point; maximum: number; kind: string }

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const finite = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y)
export function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

/** Proposed geometry only. Full unchanged certificates decide every outcome. */
export function wireNormalOffsets(a: Point, b: Point, obstacle: Point, severity: number, maximum = 0.02): Point[] {
  requireValue([a, b, obstacle].every(finite) && Number.isFinite(severity) && severity > 0 && Number.isFinite(maximum) && maximum > 0, "Invalid proposal inputs")
  const dx = b.x - a.x, dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  requireValue(Number.isFinite(length) && length > 0, "A nonzero finite wire segment is required")
  let nx = -dy / length, ny = dx / length
  const side = ((a.x + b.x) / 2 - obstacle.x) * nx + ((a.y + b.y) / 2 - obstacle.y) * ny
  requireValue(Number.isFinite(side) && side !== 0, "Obstacle-center side must be unambiguous")
  if (side < 0) { nx = -nx; ny = -ny }
  const values = [1, 2, 4, 8].map((factor) => Math.min(maximum - 1e-10, (severity + 1e-5) * factor))
  return [...new Set(values)].map((distance) => ({ x: nx * distance, y: ny * distance }))
}

export function cloneWithMoves(traces: any[], moves: Move[]): any[] {
  const candidate = structuredClone(traces)
  const seen = new Set<string>()
  for (const move of moves) {
    requireValue(finite(move.oldXY) && finite(move.newXY) && Math.hypot(move.newXY.x - move.oldXY.x, move.newXY.y - move.oldXY.y) <= move.maximum + 1e-12, "Diagnostic movement bound exceeded")
    requireValue(move.occurrences.length > 0, "A move must identify raw occurrences")
    for (const value of move.occurrences) {
      const key = value.traceIndex + ":" + value.pointIndex
      requireValue(!seen.has(key), "Overlapping move groups")
      seen.add(key)
      const trace = traces[value.traceIndex], point = trace?.route[value.pointIndex]
      requireValue(point && value.pointIndex > 0 && value.pointIndex < trace.route.length - 1 && ["wire", "via"].includes(point.route_type), "Protected endpoint or unsupported primitive")
      requireValue(!Object.keys(point).some((name) => name.toLowerCase().includes("port")), "Port-bearing point is protected")
      requireValue(point.x === move.oldXY.x && point.y === move.oldXY.y, "Move does not bind its old raw XY")
      candidate[value.traceIndex].route[value.pointIndex].x = move.newXY.x
      candidate[value.traceIndex].route[value.pointIndex].y = move.newXY.y
    }
  }
  verifyRawMask(traces, candidate, moves)
  return candidate
}

export function verifyRawMask(before: any[], after: any[], moves: Move[]): any[] {
  const allowed = new Map<string, Move>()
  for (const move of moves) for (const value of move.occurrences) {
    const key = value.traceIndex + ":" + value.pointIndex
    requireValue(!allowed.has(key), "Duplicate mutation-mask occurrence")
    allowed.set(key, move)
  }
  requireValue(before.length === after.length, "Raw trace population changed")
  const differences: any[] = []
  for (let ti = 0; ti < before.length; ti++) {
    const a = before[ti], b = after[ti]
    const withoutRoute = (value: any) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "route"))
    requireValue(same(withoutRoute(a), withoutRoute(b)) && a.route.length === b.route.length, "Trace identity, metadata or route population changed")
    for (let pi = 0; pi < a.route.length; pi++) {
      const old = a.route[pi], value = b.route[pi], move = allowed.get(ti + ":" + pi)
      if (!move) { requireValue(same(old, value), "Unselected raw point changed"); continue }
      const withoutXY = (point: any) => Object.fromEntries(Object.entries(point).filter(([key]) => !["x", "y"].includes(key)))
      requireValue(same(withoutXY(old), withoutXY(value)), "Primitive, material, layer, width or point metadata changed")
      requireValue(old.x === move.oldXY.x && old.y === move.oldXY.y && value.x === move.newXY.x && value.y === move.newXY.y, "Point differs from its exact planned move")
      differences.push({ traceIndex: ti, pointIndex: pi, kind: move.kind, oldXY: move.oldXY, newXY: move.newXY })
    }
  }
  requireValue(differences.length === allowed.size, "Mutation population mismatch")
  return differences
}

export function verifyCanonicalMask(before: any[], after: any[], traces: any[], candidate: any[], moves: Move[]): void {
  const indices = new Map(traces.map((trace, index) => [trace.pcb_trace_id, index]))
  const allowed = new Set(moves.flatMap((move) => move.occurrences.map((value) => value.traceIndex + ":" + value.pointIndex)))
  const viaMove = moves.find((move) => move.kind === "via")
  requireValue(viaMove, "Selected via movement is required")
  const selectedViaIds = new Set(before.filter((value) => value.type === "pcb_via" && value.x === viaMove.oldXY.x && value.y === viaMove.oldXY.y).map((value) => value.pcb_via_id))
  requireValue(selectedViaIds.size > 0 && before.length === after.length, "Canonical via or element population changed")
  for (const [circuit, raw] of [[before, traces], [after, candidate]]) {
    const canonicalTraces = circuit.filter((value: any) => value.type === "pcb_trace")
    requireValue(canonicalTraces.length === raw.length, "Canonical trace population differs from raw")
    for (const trace of canonicalTraces) {
      const ti = indices.get(trace.pcb_trace_id)
      requireValue(ti !== undefined && trace.route.length === raw[ti].route.length, "Canonical route population differs from raw")
      for (let pi = 0; pi < trace.route.length; pi++) {
        const point = raw[ti].route[pi]
        requireValue(["wire", "via"].includes(point.route_type), "Unsupported canonical/raw primitive")
        const fields = point.route_type === "wire" ? ["route_type", "x", "y", "width", "layer"] : ["route_type", "x", "y", "from_layer", "to_layer"]
        requireValue(fields.every((key) => trace.route[pi][key] === point[key]), "Canonical geometry differs from its exact raw point")
      }
    }
  }
  const strip = (value: any): any => {
    if (value.type === "pcb_via" && selectedViaIds.has(value.pcb_via_id)) return Object.fromEntries(Object.entries(value).filter(([key]) => !["x", "y"].includes(key)))
    if (value.type === "pcb_trace") {
      const ti = indices.get(value.pcb_trace_id)
      requireValue(ti !== undefined, "Unmapped canonical trace")
      return { ...value, route: value.route.map((point: any, pi: number) => allowed.has(ti + ":" + pi)
        ? Object.fromEntries(Object.entries(point).filter(([key]) => !["x", "y"].includes(key))) : point) }
    }
    return value
  }
  requireValue(same(before.map(strip), after.map(strip)), "Protected canonical geometry, IDs, material or metadata changed")
  const afterVias = after.filter((value) => selectedViaIds.has(value.pcb_via_id))
  requireValue(afterVias.length === selectedViaIds.size && afterVias.every((value) => value.x === viaMove.newXY.x && value.y === viaMove.newXY.y), "Selected canonical aliases did not move together")
}
