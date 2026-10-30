import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { Pipeline9IntentOwners, type OriginalIntentJson } from "./checkPipeline9OriginalIntentCopper"
import { collectRawViaSites, type WitnessViaCertificate } from "./getPipeline9WitnessViaCertificate"
import { areCopperSweepsSeparated, isWireDiskInsideSmtLand, isCopperPointWithinRadius, type CopperPoint, type CopperSweep } from "./relativeCopperSweepGeometry"

export type RelativeWitnessMove = {
  kind: "via" | "wire"
  occurrences: { traceIndex: number; pointIndex: number; oldXY: CopperPoint; newXY: CopperPoint }[]
}
type Input = {
  original: SimpleRouteJson; pointPairs: SimpleRouteJson
  before: SimplifiedPcbTrace[]; after: SimplifiedPcbTrace[]
  baselineCertificate: WitnessViaCertificate; candidateCertificate: WitnessViaCertificate
  moves: RelativeWitnessMove[]
}
type Proof = { status: "PASS" | "UNKNOWN"; reason: string; bundleCount: number; boundaryCount: number; primitivePairs: number }
type Wire = Extract<SimplifiedPcbTrace["route"][number], { route_type: "wire" }>
type Boundary = { traceIndex: number; pointIndex: number; layer: string; radius: number; segmentId: string; tailId: string }
type Primitive = { id: string; kind: "wire" | "via" | "obstacle" | "terminal"; layers: string[]; sweep: CopperSweep; traceIndex?: number; segmentIndex?: number; obstacleIndex?: number }
type Bundle = { owner: string; primitives: Primitive[]; boundaries: Boundary[] }
const PROOF_MARGIN = 1e-7
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const sameXY = (a: CopperPoint, b: CopperPoint): boolean => a.x === b.x && a.y === b.y
const segmentId = (trace: number, point: number): string => `wire:${trace}:${point}`

/** A bounded interface-replacement proof, independent of the global demand graph.
 * Unknown fixed contacts cancel because all fixed material stays unchanged.
 * Only an unchanged wire-tail boundary or an explicitly solid owned SMT land
 * can be an interface. Original PTH interiors never create a conductive bridge.
 */
export function provePipeline9RelativeContacts(input: Input): Proof {
  const { original, pointPairs, before, after, moves, baselineCertificate, candidateCertificate } = input
  const unknown = (reason: string): Proof => ({ status: "UNKNOWN", reason, bundleCount: 0, boundaryCount: 0, primitivePairs: 0 })
  if ((original.traces?.length ?? 0) > 0 || before.some((trace) => trace.__replaces_pcb_trace_id !== undefined)) return unknown("Fixed/preloaded copper is outside the relative proof domain")
  if (baselineCertificate.copper.allPublishedCopperChecksRun !== true || candidateCertificate.copper.allPublishedCopperChecksRun !== true || baselineCertificate.copper.ownershipCoverageStatus !== "COMPLETE" || candidateCertificate.copper.ownershipCoverageStatus !== "COMPLETE") return unknown("Original ownership coverage is incomplete")
  if (moves.filter((move) => move.kind === "via").length !== 1 || moves.filter((move) => move.kind === "wire").length > 1 || moves.length > 2) return unknown("Only one via bundle and one optional two-vertex wire bundle are supported")
  const allowed = new Map<string, RelativeWitnessMove["occurrences"][number]>()
  for (const move of moves) {
    const maximum = move.kind === "via" ? 0.25 : 0.02
    if (move.occurrences.length === 0) return unknown("A move has no raw occurrences")
    for (const occurrence of move.occurrences) {
      if (![occurrence.oldXY.x, occurrence.oldXY.y, occurrence.newXY.x, occurrence.newXY.y].every((v) => Number.isFinite(v) && (v === 0 || Math.abs(v) >= 2 ** -64 && Math.abs(v) <= 2 ** 64)) ||
        sameXY(occurrence.oldXY, occurrence.newXY) || !isCopperPointWithinRadius(occurrence.oldXY, occurrence.newXY, maximum)) return unknown("A move is nonfinite, empty or exceeds its exact hard cap")
      const key = `${occurrence.traceIndex}:${occurrence.pointIndex}`
      if (allowed.has(key)) return unknown("Mutation groups overlap")
      allowed.set(key, occurrence)
    }
  }
  if (before.length !== after.length) return unknown("Raw trace population changed")
  for (const [ti, trace] of before.entries()) {
    const candidate = after[ti]!
    const withoutRoute = (value: SimplifiedPcbTrace): unknown => ({ ...value, route: undefined })
    if (!candidate || !same(withoutRoute(trace), withoutRoute(candidate)) || trace.route.length !== candidate.route.length) return unknown("Raw trace identity or metadata changed")
    for (const [pi, point] of trace.route.entries()) {
      const next = candidate.route[pi]!, move = allowed.get(`${ti}:${pi}`)
      if (!move) { if (!same(point, next)) return unknown("An unselected raw point changed"); continue }
      if ((point.route_type !== "wire" && point.route_type !== "via") || next.route_type !== point.route_type ||
        pi === 0 || pi === trace.route.length - 1 || (point.route_type === "wire" && (point.start_pcb_port_id !== undefined || point.end_pcb_port_id !== undefined))) return unknown("Protected endpoint or unsupported raw mutation")
      const strip = (value: typeof point): unknown => ({ ...value, x: undefined, y: undefined })
      if (!same(strip(point), strip(next as typeof point)) || !sameXY(point, move.oldXY) || !sameXY(next as CopperPoint, move.newXY)) return unknown("Raw material, layers or planned XY mask changed")
      allowed.delete(`${ti}:${pi}`)
    }
  }
  if (allowed.size > 0) return unknown("A planned mutation occurrence is absent")
  const owners = new Pipeline9IntentOwners(original, pointPairs)
  const inventory = collectRawViaSites(original, pointPairs, before, owners, baselineCertificate.circuitJson)
  const finalInventory = collectRawViaSites(original, pointPairs, after, owners, candidateCertificate.circuitJson)
  if (inventory.reasons.length > 0 || finalInventory.reasons.length > 0) return unknown("Raw/canonical material inventory is incomplete")
  if (!Number.isSafeInteger(original.layerCount) || original.layerCount < 1 || original.layerCount > 10) return unknown("Unsupported original stack")
  const stack = original.layerCount === 1 ? ["top"] : ["top", ...Array.from({ length: original.layerCount - 2 }, (_, i) => `inner${i + 1}`), "bottom"]
  const validLayers = (layers: string[]): boolean => layers.length > 0 && new Set(layers).size === layers.length && layers.every((layer) => stack.includes(layer))
  if (original.obstacles.some((obstacle) => !validLayers(obstacle.layers)) || original.connections.some((connection) => connection.pointsToConnect.some((point) => !validLayers(point.layers ?? [point.layer!]) || point.layers !== undefined && point.layer !== undefined))) return unknown("Original layers are incomplete or ambiguous")
  const selectedIndices = new Set(moves.flatMap((move) => move.occurrences.map((occurrence) => `${occurrence.traceIndex}:${occurrence.pointIndex}`)))
  const traceIndices = new Map(before.map((trace, index) => [trace.pcb_trace_id, index]))
  const selectedViaIds = new Set(baselineCertificate.circuitJson.filter((value) => value.type === "pcb_via" && sameXY(value as CopperPoint, moves.find((move) => move.kind === "via")!.occurrences[0]!.oldXY)).map((value) => value.pcb_via_id))
  const stripCanonical = (element: OriginalIntentJson): OriginalIntentJson => {
    if (element.type === "pcb_via" && selectedViaIds.has(element.pcb_via_id)) return { ...element, x: undefined, y: undefined }
    if (element.type !== "pcb_trace") return element
    const ti = traceIndices.get(element.pcb_trace_id)
    if (ti === undefined) return element
    return { ...element, route: element.route.map((point: OriginalIntentJson, pi: number) => selectedIndices.has(`${ti}:${pi}`) ? { ...point, x: undefined, y: undefined } : point) }
  }
  if (!same(baselineCertificate.circuitJson.map(stripCanonical), candidateCertificate.circuitJson.map(stripCanonical))) return unknown("Protected canonical geometry, population or metadata changed")
  const supportedNumber = (value: number): boolean => Number.isFinite(value) && (value === 0 || (Math.abs(value) >= 2 ** -64 && Math.abs(value) <= 2 ** 64))
  if (before.some((trace) => trace.route.some((point) => point.route_type !== "wire" && point.route_type !== "via" ? true : !supportedNumber(point.x) || !supportedNumber(point.y) || (point.route_type === "wire" ? !supportedNumber(point.width) : ![point.via_diameter ?? 0, point.via_hole_diameter ?? 0].every(supportedNumber)))) ||
    original.obstacles.some((obstacle) => ![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height, obstacle.ccwRotationDegrees ?? 0].every(supportedNumber) || obstacle.width <= 0 || obstacle.height <= 0) ||
    original.connections.some((connection) => connection.pointsToConnect.some((point) => ![point.x, point.y].every(supportedNumber)))) return unknown("Geometry is outside the exact arithmetic domain")
  if (inventory.sites.some((value) => !validLayers(value.layers) || ![value.diameter, value.drill, value.diameter / 2, value.drill / 2].every(supportedNumber))) return unknown("Via dimensions are outside the exact arithmetic domain")
  const wirePrimitive = (ti: number, pi: number): Primitive | undefined => {
    const a = before[ti]!.route[pi], b = before[ti]!.route[pi + 1]
    const na = after[ti]!.route[pi], nb = after[ti]!.route[pi + 1]
    if (a?.route_type !== "wire" || b?.route_type !== "wire" || na?.route_type !== "wire" || nb?.route_type !== "wire" || a.layer !== b.layer || !stack.includes(a.layer) || a.width <= 0 || b.width <= 0) return undefined
    return { id: segmentId(ti, pi), kind: "wire", traceIndex: ti, segmentIndex: pi, layers: [a.layer], sweep: { points: [a, b, na, nb], radius: Math.max(a.width, b.width) / 2 } }
  }
  const viaMove = moves.find((move) => move.kind === "via")!
  const viaCoordinates = viaMove.occurrences[0]!
  if (viaMove.occurrences.some((value) => !sameXY(value.oldXY, viaCoordinates.oldXY) || !sameXY(value.newXY, viaCoordinates.newXY))) return unknown("Coupled via coordinates disagree")
  const site = inventory.sites.find((value) => sameXY(value, viaCoordinates.oldXY))
  const finalSite = finalInventory.sites.find((value) => sameXY(value, viaCoordinates.newXY))
  if (!site || !finalSite || site.drill <= 0 || site.drill >= site.diameter || !same({ ...site, x: 0, y: 0 }, { ...finalSite, x: 0, y: 0 })) return unknown("Selected manufactured via material/span or aliases changed")
  const actualOccurrences: { traceIndex: number; pointIndex: number }[] = []
  for (const [ti, trace] of before.entries()) for (const [pi, point] of trace.route.entries()) {
    if ((point.route_type === "wire" || point.route_type === "via") && sameXY(point, site) && (point.route_type === "via" || site.layers.includes(point.layer))) {
      const owner = owners.traceReference(trace.connection_name)
      if (owner.status !== "RESOLVED" || owner.owner !== site.owner) return unknown("A coincident via landing has a foreign or unresolved owner")
      actualOccurrences.push({ traceIndex: ti, pointIndex: pi })
    }
  }
  if (!same(actualOccurrences, viaMove.occurrences.map(({ traceIndex, pointIndex }) => ({ traceIndex, pointIndex })))) return unknown("Every coincident via occurrence and landing must move together in raw order")
  const viaPrimitive: Primitive = { id: "selected-via", kind: "via", layers: site.layers, sweep: { points: [site, viaCoordinates.newXY], radius: site.diameter / 2 } }
  const viaBundle: Bundle = { owner: site.owner, primitives: [viaPrimitive], boundaries: [] }
  const absorbed = new Set<string>()
  for (const occurrence of site.occurrences) for (const direction of [-1, 1]) {
    const ti = occurrence.traceIndex, trace = before[ti]!
    let current = occurrence.pointIndex + direction
    const landing = trace.route[current]
    if (landing?.route_type !== "wire" || !sameXY(landing, site) || landing.layer !== (direction === -1 ? (trace.route[occurrence.pointIndex] as { from_layer: string }).from_layer : (trace.route[occurrence.pointIndex] as { to_layer: string }).to_layer)) return unknown("Via fanout does not begin at its exact declared landing")
    let found = false
    for (let count = 0; count < 32; count++) {
      const nextIndex = current + direction, next = trace.route[nextIndex]
      const segment = wirePrimitive(ti, Math.min(current, nextIndex))
      if (!segment || next?.route_type !== "wire" || next.layer !== landing.layer) break
      if (!absorbed.has(segment.id)) { absorbed.add(segment.id); viaBundle.primitives.push(segment) }
      const newPoint = after[ti]!.route[nextIndex] as Wire
      if (sameXY(next, newPoint) && areCopperSweepsSeparated({ points: [next], radius: Math.max(next.width, landing.width) / 2 }, viaPrimitive.sweep, PROOF_MARGIN)) {
        const tailIndex = direction === -1 ? nextIndex - 1 : nextIndex
        if (!wirePrimitive(ti, tailIndex)) return unknown("A via boundary needs an unchanged immediate wire tail")
        viaBundle.boundaries.push({ traceIndex: ti, pointIndex: nextIndex, layer: next.layer, radius: next.width / 2, segmentId: segment.id, tailId: segmentId(ti, tailIndex) })
        found = true
        break
      }
      current = nextIndex
    }
    if (!found) return unknown("Via fanout has no bounded unchanged exterior interface")
  }
  const bundles: Bundle[] = [viaBundle]
  const wireMove = moves.find((move) => move.kind === "wire")
  if (wireMove) {
    if (wireMove.occurrences.length !== 2) return unknown("Wire movement requires exactly two consecutive vertices")
    const [a, b] = wireMove.occurrences
    if (!a || !b || a.traceIndex !== b.traceIndex || b.pointIndex !== a.pointIndex + 1) return unknown("Wire vertices are not one ordered adjacent pair")
    const owner = owners.traceReference(before[a.traceIndex]!.connection_name)
    if (owner.status !== "RESOLVED") return unknown("Wire bundle has no original owner")
    const bundle: Bundle = { owner: owner.owner, primitives: [], boundaries: [] }
    for (let pi = a.pointIndex - 1; pi <= b.pointIndex; pi++) {
      const segment = wirePrimitive(a.traceIndex, pi)
      if (!segment || absorbed.has(segment.id)) return unknown("Wire and via mutation bundles overlap")
      bundle.primitives.push(segment); absorbed.add(segment.id)
    }
    if (new Set(bundle.primitives.flatMap((value) => value.layers)).size !== 1) return unknown("Wire bundle changes layer without a via")
    for (const [pi, si, tail] of [[a.pointIndex - 1, a.pointIndex - 1, a.pointIndex - 2], [b.pointIndex + 1, b.pointIndex, b.pointIndex + 1]]) {
      const point = before[a.traceIndex]!.route[pi!] as Wire
      if (!wirePrimitive(a.traceIndex, tail!) || !same(point, after[a.traceIndex]!.route[pi!])) return unknown("Wire boundary has no unchanged immediate tail")
      bundle.boundaries.push({ traceIndex: a.traceIndex, pointIndex: pi!, layer: point.layer, radius: point.width / 2, segmentId: segmentId(a.traceIndex, si!), tailId: segmentId(a.traceIndex, tail!) })
    }
    bundles.push(bundle)
  }
  if (bundles.some((bundle) => bundle.primitives.length > 64)) return unknown("Relative proof bundle exceeds its bounded domain")
  for (const bundle of bundles) {
    for (const primitive of bundle.primitives) if (primitive.kind === "wire") {
      const a = before[primitive.traceIndex!]!.route[primitive.segmentIndex!] as Wire, b = before[primitive.traceIndex!]!.route[primitive.segmentIndex! + 1] as Wire
      if (a.width !== b.width) return unknown("Variable-width replacement segments require a separate material proof")
    }
    for (const boundary of bundle.boundaries) {
      const tailIndex = Number(boundary.tailId.split(":")[2])
      const a = before[boundary.traceIndex]!.route[tailIndex] as Wire, b = before[boundary.traceIndex]!.route[tailIndex + 1] as Wire
      if (a.width !== boundary.radius * 2 || b.width !== a.width) return unknown("A fixed interface disk lacks constant-width tail material")
    }
  }
  const fixed: Primitive[] = []
  for (const [ti, trace] of before.entries()) {
    for (let pi = 0; pi + 1 < trace.route.length; pi++) {
      const a = trace.route[pi]!, b = trace.route[pi + 1]!
      if (a.route_type === "wire" && b.route_type === "wire") {
        const segment = wirePrimitive(ti, pi)
        if (!segment) return unknown("Unsupported wire layer transition")
        if (!absorbed.has(segment.id)) {
          if (!same(a, after[ti]!.route[pi]) || !same(b, after[ti]!.route[pi + 1])) return unknown("A changed wire segment was not absorbed into a replacement bundle")
          fixed.push(segment)
        }
      } else if ((a.route_type === "via" || a.route_type === "wire") && (b.route_type === "via" || b.route_type === "wire")) {
        const endLayer = a.route_type === "via" ? a.to_layer : a.layer, startLayer = b.route_type === "via" ? b.from_layer : b.layer
        if (!sameXY(a, b) || endLayer !== startLayer) return unknown("Raw via adjacency is discontinuous")
      } else return unknown("Unsupported generated conductor")
    }
  }
  for (const value of inventory.sites) if (value !== site) fixed.push({ id: `via:${value.x}:${value.y}`, kind: "via", layers: value.layers, sweep: { points: [value], radius: value.diameter / 2 } })
  for (const [oi, obstacle] of original.obstacles.entries()) {
    if (obstacle.type !== "rect" && (obstacle.type as string) !== "oval") return unknown("Unsupported original outer footprint")
    const w = obstacle.width / 2, h = obstacle.height / 2
    const rotated = (obstacle.ccwRotationDegrees ?? 0) !== 0
    // Occupy inferred circular projections as well as the authoritative outer
    // footprint. These bounds can exclude contact, never establish copper.
    const circular = obstacle.shape === "circle" || (obstacle.type as string) === "oval" || !rotated && !!obstacle.circuitJsonMetadata?.pcb_plated_hole_id && Math.abs(obstacle.width - obstacle.height) < 0.001
    const roundHalf = Math.max(w, h)
    fixed.push({ id: `obstacle:${oi}`, kind: "obstacle", obstacleIndex: oi, layers: obstacle.layers, sweep: { box: { center: obstacle.center, halfWidth: rotated ? [w, h] : circular ? [roundHalf] : [w], halfHeight: rotated ? [w, h] : circular ? [roundHalf] : [h] }, radius: 0 } })
  }
  for (const [ci, connection] of original.connections.entries()) for (const [pi, point] of connection.pointsToConnect.entries()) fixed.push({ id: `terminal:${ci}:${pi}`, kind: "terminal", layers: point.layers ?? [point.layer!], sweep: { points: [point], radius: 0 } })
  let primitivePairs = 0
  const shared = (a: Primitive, b: Primitive): boolean => a.layers.some((layer) => b.layers.includes(layer))
  for (const stationary of fixed) if (shared(viaPrimitive, stationary) && !areCopperSweepsSeparated(viaPrimitive.sweep, stationary.sweep, PROOF_MARGIN)) return unknown("The moving via could alter fixed material or an unknown original footprint")
  for (let bi = 0; bi < bundles.length; bi++) for (let bj = bi + 1; bj < bundles.length; bj++) for (const a of bundles[bi]!.primitives) for (const b of bundles[bj]!.primitives) {
    if (shared(a, b) && !areCopperSweepsSeparated(a.sweep, b.sweep, PROOF_MARGIN)) return unknown("Distinct replacement bundles could contact")
  }
  for (const bundle of bundles) for (const moving of bundle.primitives) for (const stationary of fixed) {
    if (!shared(moving, stationary)) continue
    primitivePairs++
    if (areCopperSweepsSeparated(moving.sweep, stationary.sweep, PROOF_MARGIN)) continue
    const boundaries = bundle.boundaries.filter((boundary) => boundary.segmentId === moving.id)
    if (stationary.kind === "wire" && boundaries.some((boundary) => boundary.tailId === stationary.id)) continue
    if (stationary.kind === "obstacle") {
      const obstacle = original.obstacles[stationary.obstacleIndex!]!, meta = obstacle.circuitJsonMetadata
      const owner = owners.obstacle(obstacle)
      if (owner.status === "RESOLVED" && owner.owner === bundle.owner && obstacle.type === "rect" && obstacle.isCopperPour !== true && obstacle.layers.length === 1 && !obstacle.isNonPlatedHole && !meta?.pcb_plated_hole_id && typeof meta?.pcb_smtpad_id === "string" &&
        boundaries.some((boundary) => boundary.layer === obstacle.layers[0] && isWireDiskInsideSmtLand(before[boundary.traceIndex]!.route[boundary.pointIndex] as Wire, boundary.radius, obstacle, PROOF_MARGIN))) continue
    }
    return unknown(`Uncertified fixed contact: ${moving.id} / ${stationary.id}`)
  }
  return { status: "PASS", reason: "Each connected replacement bundle preserves exactly its fixed copper interfaces; global connectivity remains independently reported", bundleCount: bundles.length, boundaryCount: bundles.reduce((total, bundle) => total + bundle.boundaries.length, 0), primitivePairs }
}
