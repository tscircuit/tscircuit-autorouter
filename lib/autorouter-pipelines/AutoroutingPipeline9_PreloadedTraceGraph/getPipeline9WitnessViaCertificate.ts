import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkPadPadClearance,
  checkPadTraceClearance,
  checkSameNetViaSpacing,
  checkViaPadClearance,
  checkViaTraceClearance,
  checkViasInPads,
} from "@tscircuit/checks"
import { getFixedObstacleViolations, getNewViaPadViolations } from "@tscircuit/repair04"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import {
  checkPipeline9OriginalIntentCopper,
  Pipeline9IntentOwners,
  type OriginalIntentJson,
} from "./checkPipeline9OriginalIntentCopper"

type RawPoint = Extract<SimplifiedPcbTrace["route"][number], { route_type: "wire" | "via" }>
type Point = { x: number; y: number }
export type WitnessViaSite = {
  x: number
  y: number
  owner: string
  layers: string[]
  diameter: number
  drill: number
  occurrences: { traceIndex: number; pointIndex: number }[]
}
export type WitnessViaCertificate = {
  status: "PASS" | "FAIL" | "UNKNOWN"
  reasons: string[]
  copper: OriginalIntentJson
  referenceErrorCount: number
  demandsChecked: number
  srjObstacleViolationCount: number
  viaInPadViolationCount: number
  viaPadPolicyViolationCount: number
  sites: WitnessViaSite[]
  circuitJson: OriginalIntentJson[]
}

/** An exact key denotes physical contact, never declared net equivalence. */
function contactKey(owner: string, x: number, y: number, layer: string): string {
  const components = [owner, x, y, layer]
  if (![x, y].every(Number.isFinite)) {
    throw new Error("Witness connectivity received nonfinite contact geometry")
  }
  return JSON.stringify(components)
}

/** Additional bridges are limited to actual single-layer SMT copper. */
function insideSmtPad(point: { x: number; y: number }, pad: OriginalIntentJson): boolean {
  if (pad.type !== "pcb_smtpad") return false
  const angle = ((pad.ccw_rotation ?? 0) * Math.PI) / 180
  const dx = point.x - pad.x
  const dy = point.y - pad.y
  const x = dx * Math.cos(angle) + dy * Math.sin(angle)
  const y = -dx * Math.sin(angle) + dy * Math.cos(angle)
  if (pad.shape === "circle") return x * x + y * y <= pad.radius * pad.radius
  if (pad.shape !== "rect" && pad.shape !== "rotated_rect") return false
  return Math.abs(x) <= pad.width / 2 && Math.abs(y) <= pad.height / 2
}

function pointSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = dx * dx + dy * dy
  const ratio = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length))
  return Math.hypot(point.x - start.x - ratio * dx, point.y - start.y - ratio * dy)
}

/** Conservative board copper-envelope guard, including manufactured via lands. */
export function checkBoardEnvelope(original: SimpleRouteJson, traces: SimplifiedPcbTrace[], sites: WitnessViaSite[]): string[] {
  const { minX, minY, maxX, maxY } = original.bounds
  const boardClearance = original.minBoardEdgeClearance ?? 0
  if (![minX, minY, maxX, maxY, boardClearance].every(Number.isFinite) || minX >= maxX || minY >= maxY || boardClearance < 0) return ["Invalid board bounds/clearance"]
  const polygon = [...(original.outline ?? [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }])]
  if (polygon.length > 1 && polygon[0]!.x === polygon.at(-1)!.x && polygon[0]!.y === polygon.at(-1)!.y) polygon.pop()
  if (polygon.length < 3 || polygon.some((point) => ![point.x, point.y].every(Number.isFinite))) return ["Unsupported board outline"]
  const cross = (a: Point, b: Point, c: Point): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  let area = 0
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!
    const b = polygon[(index + 1) % polygon.length]!
    area += a.x * b.y - a.y * b.x
    if (a.x === b.x && a.y === b.y) return ["Degenerate board outline"]
    for (let other = index + 1; other < polygon.length; other++) {
      if (other === index + 1 || (index === 0 && other === polygon.length - 1)) continue
      const c = polygon[other]!
      const d = polygon[(other + 1) % polygon.length]!
      const properCrossing = cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
      const touching = Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b)) === 0
      if (properCrossing || touching) return ["Self-intersecting board outline"]
    }
  }
  if (!Number.isFinite(area) || area === 0) return ["Degenerate board outline"]
  const inside = (point: Point): boolean => {
    let result = false
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index]!
      const b = polygon[(index + 1) % polygon.length]!
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result
    }
    return result
  }
  const clear = (start: Point, end: Point, radius: number): boolean => {
    const required = radius + boardClearance
    if (!Number.isFinite(required) || radius <= 0 || !inside(start) || !inside(end)) return false
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index]!
      const b = polygon[(index + 1) % polygon.length]!
      if (cross(start, end, a) * cross(start, end, b) < 0 && cross(a, b, start) * cross(a, b, end) < 0) return false
      const distance = Math.min(pointSegmentDistance(start, a, b), pointSegmentDistance(end, a, b), pointSegmentDistance(a, start, end), pointSegmentDistance(b, start, end))
      if (!Number.isFinite(distance) || distance < required) return false
    }
    return true
  }
  for (const site of sites) if (!clear(site, site, site.diameter / 2)) return ["Manufactured via copper exceeds board envelope"]
  for (const trace of traces) {
    for (let index = 0; index + 1 < trace.route.length; index++) {
      const a = trace.route[index]!
      const b = trace.route[index + 1]!
      if (a.route_type === "wire" && b.route_type === "wire" && !clear(a, b, Math.max(a.width, b.width) / 2)) return ["Wire copper exceeds board envelope"]
    }
  }
  return []
}

/** Proves the original demands through explicit conductive point/edge witnesses.
 * Interior-only intersections may be missed; they never create a false PASS.
 * Exact declared terminals use the SRJ point-contact model, not a manufacturing
 * assertion about a drill void. PTH outer envelopes do not create extra bridges.
 */
function checkDemandGraph(
  original: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
  owners: Pipeline9IntentOwners,
  copper: OriginalIntentJson,
  circuit: OriginalIntentJson[],
  sites: WitnessViaSite[],
): { reasons: string[]; demands: number } {
  const parents = new Map<string, string>()
  const points: { key: string; owner: string; x: number; y: number; layer: string }[] = []
  const find = (key: string): string => {
    const parent = parents.get(key)
    if (parent === undefined) throw new Error("Witness graph lost a registered node")
    if (parent === key) return key
    const root = find(parent)
    parents.set(key, root)
    return root
  }
  const join = (left: string, right: string): void => {
    const a = find(left)
    const b = find(right)
    if (a !== b) parents.set(b, a)
  }
  const add = (owner: string, x: number, y: number, layer: string): string => {
    const key = contactKey(owner, x, y, layer)
    if (!parents.has(key)) {
      parents.set(key, key)
      points.push({ key, owner, x, y, layer })
    }
    return key
  }
  const reasons: string[] = []
  for (const trace of traces) {
    const owner = owners.traceReference(trace.connection_name)
    if (owner.status !== "RESOLVED") return { reasons: ["Unresolved raw trace owner"], demands: 0 }
    let previous: { point: RawPoint; first: string; last: string } | undefined
    for (const point of trace.route) {
      if (point.route_type !== "wire" && point.route_type !== "via") {
        return { reasons: ["Unsupported route primitive"], demands: 0 }
      }
      const layer = point.route_type === "wire" ? point.layer : point.from_layer
      const first = add(owner.owner, point.x, point.y, layer)
      let last = first
      if (point.route_type === "via") {
        const site = sites.find((site) => site.x === point.x && site.y === point.y)
        if (!site) throw new Error("Witness graph lost a validated raw via")
        for (const viaLayer of site.layers) join(first, add(owner.owner, point.x, point.y, viaLayer))
        last = add(owner.owner, point.x, point.y, point.to_layer)
      }
      if (previous) {
        const before = previous.point
        if (before.route_type === "wire" && point.route_type === "wire") {
          if (before.layer !== point.layer) reasons.push("Wire layer changes without a via")
          else join(previous.last, first)
        } else {
          const previousLayer = before.route_type === "via" ? before.to_layer : before.route_type === "wire" ? before.layer : ""
          if (before.x !== point.x || before.y !== point.y || previousLayer !== layer) reasons.push("Discontinuous via adjacency")
          else join(previous.last, first)
        }
      }
      previous = { point, first, last }
    }
  }
  // A pad fragment is one physical node on one actual layer. Neither shared
  // IDs nor ownership joins disconnected fragments or unspecified barrels.
  for (const padOwner of copper.padOwners) {
    if (padOwner.status !== "RESOLVED") continue
    const pad = circuit[padOwner.canonicalIndex]
    if (pad.type !== "pcb_smtpad") continue
    const touching = points.filter((point) => point.owner === padOwner.owner && point.layer === pad.layer && insideSmtPad(point, pad))
    for (let index = 1; index < touching.length; index++) join(touching[0]!.key, touching[index]!.key)
  }
  let demands = 0
  const ownerTerminals = new Map<string, SimpleRouteJson["connections"][number]["pointsToConnect"]>()
  for (const connection of original.connections) {
    const owner = owners.originalReference(connection.name)
    if (owner.status !== "RESOLVED" || connection.pointsToConnect.length === 0) {
      reasons.push("Original demanded declarations are incomplete")
      continue
    }
    const terminals = ownerTerminals.get(owner.owner) ?? []
    terminals.push(...connection.pointsToConnect)
    ownerTerminals.set(owner.owner, terminals)
  }
  for (const [owner, terminals] of ownerTerminals) {
    demands++
    let common: Set<string> | undefined
    const ownerPoints = points.filter((point) => point.owner === owner)
    const ownerPads = copper.padOwners.filter((pad: OriginalIntentJson) => pad.owner === owner)
    for (const terminal of terminals) {
      const layers = "layers" in terminal && terminal.layers ? terminal.layers : [terminal.layer!]
      const contacts = new Set<string>()
      const stack = original.layerCount === 1 ? ["top"] : ["top", ...Array.from({ length: original.layerCount - 2 }, (_, index) => `inner${index + 1}`), "bottom"]
      if (![terminal.x, terminal.y].every(Number.isFinite) || layers.length === 0 || layers.some((layer) => !stack.includes(layer)) || ("layers" in terminal && terminal.layers !== undefined && terminal.layer !== undefined)) {
        reasons.push("Invalid original terminal geometry/layers")
        common = new Set()
        continue
      }
      if (original.obstacles.some((obstacle) => obstacle.isNonPlatedHole && terminal.pcb_port_id !== undefined &&
        (obstacle.circuitJsonMetadata?.pcb_port_id === terminal.pcb_port_id || obstacle.connectedTo.includes(terminal.pcb_port_id)))) {
        reasons.push("Non-plated hole cannot satisfy an electrical terminal")
        common = new Set()
        continue
      }
      for (const layer of layers) {
        const exact = contactKey(owner, terminal.x, terminal.y, layer)
        if (parents.has(exact)) contacts.add(find(exact))
        for (const padOwner of ownerPads) {
          const pad = circuit[padOwner.canonicalIndex]
          if (pad.type !== "pcb_smtpad" || pad.layer !== layer || !insideSmtPad(terminal, pad)) continue
          for (const point of ownerPoints) {
            if (point.layer === layer && insideSmtPad(point, pad)) contacts.add(find(point.key))
          }
        }
      }
      common = common === undefined ? contacts : new Set([...common].filter((root) => contacts.has(root)))
    }
    if (common === undefined || common.size === 0) reasons.push("An original net's demanded terminals lack one common physical component")
    else if (ownerPoints.some((point) => !common!.has(find(point.key)))) reasons.push("Generated copper is disconnected from its original demanded net")
  }
  return { reasons, demands }
}

/** Full raw inventory prevents owner-blind canonical via dedup from hiding
 * an unselected conflicting owner, material, fixed via, or manufactured span.
 */
export function collectRawViaSites(
  original: SimpleRouteJson,
  pointPairs: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
  owners: Pipeline9IntentOwners,
  circuit: OriginalIntentJson[],
): { reasons: string[]; sites: WitnessViaSite[] } {
  const reasons: string[] = []
  const sites = new Map<string, WitnessViaSite>()
  const exportedTransitions = new Set<string>()
  const expectedExports: { site: WitnessViaSite; traceId: string }[] = []
  const dimensions = getViaDimensions(pointPairs)
  const diameter = original.minViaDiameter ?? dimensions.padDiameter
  const drill = pointPairs.min_via_hole_diameter ?? pointPairs.minViaHoleDiameter ?? (original.minViaDiameter !== undefined ? diameter * 0.5 : dimensions.holeDiameter)
  const stack = original.layerCount === 1 ? ["top"] : ["top", ...Array.from({ length: original.layerCount - 2 }, (_, i) => `inner${i + 1}`), "bottom"]
  const ids = new Set<string>()
  for (const [traceIndex, trace] of traces.entries()) {
    if (ids.has(trace.pcb_trace_id)) reasons.push("Duplicate raw trace identity")
    ids.add(trace.pcb_trace_id)
    const owner = owners.traceReference(trace.connection_name)
    if (owner.status !== "RESOLVED") return { reasons: ["Unresolved raw trace identity"], sites: [] }
    const canonical = circuit.filter((element) => element.type === "pcb_trace" && element.pcb_trace_id === trace.pcb_trace_id)
    const expected: OriginalIntentJson[] = []
    for (const [pointIndex, point] of trace.route.entries()) {
      if (point.route_type === "wire") {
        if (![point.x, point.y, point.width].every(Number.isFinite) || point.width <= 0 || !stack.includes(point.layer)) reasons.push("Unsupported wire geometry")
        expected.push({ route_type: "wire", x: point.x, y: point.y, width: point.width, layer: point.layer })
        const exportedPoint = canonical[0]?.route?.[pointIndex]
        if ((point.start_pcb_port_id !== undefined && exportedPoint?.start_pcb_port_id !== point.start_pcb_port_id) ||
          (point.end_pcb_port_id !== undefined && exportedPoint?.end_pcb_port_id !== point.end_pcb_port_id)) reasons.push("Explicit raw terminal metadata is not preserved")
        continue
      }
      if (point.route_type !== "via") {
        reasons.push("Unsupported raw route primitive")
        continue
      }
      const from = stack.indexOf(point.from_layer)
      const to = stack.indexOf(point.to_layer)
      const layers = original.allowBlindAndBuriedVias === true ? point.layers ?? stack.slice(Math.min(from, to), Math.max(from, to) + 1) : stack
      const outer = point.via_diameter ?? diameter
      const hole = point.via_hole_diameter ?? drill
      if (![point.x, point.y, outer, hole].every(Number.isFinite) || from < 0 || to < 0 || from === to || outer <= 0 || hole <= 0 || hole > outer || !layers.includes(point.from_layer) || !layers.includes(point.to_layer)) reasons.push("Unsupported via geometry")
      const key = JSON.stringify([point.x, point.y])
      const previous = sites.get(key)
      const site: WitnessViaSite = { x: point.x, y: point.y, owner: owner.owner, layers: [...layers], diameter: outer, drill: hole, occurrences: [{ traceIndex, pointIndex }] }
      if (previous) {
        if (previous.owner !== site.owner || previous.diameter !== outer || previous.drill !== hole || JSON.stringify(previous.layers) !== JSON.stringify(layers)) reasons.push("Ambiguous coincident raw via ownership/material/span")
        previous.occurrences.push({ traceIndex, pointIndex })
      } else sites.set(key, site)
      // Native export retains the first occurrence of each directed transition.
      // Several transitions can describe one manufactured through-via site;
      // all occurrences still share the owner/material/span checks above.
      const transition = JSON.stringify([point.x, point.y, point.from_layer, point.to_layer])
      if (!exportedTransitions.has(transition)) {
        exportedTransitions.add(transition)
        expectedExports.push({ site, traceId: trace.pcb_trace_id })
      }
      expected.push({ route_type: "via", x: point.x, y: point.y, from_layer: point.from_layer, to_layer: point.to_layer })
    }
    // Native checking adds inferred port annotations to its own canonical
    // points. They are not physical geometry or trusted ownership evidence.
    const actualGeometry = canonical[0]?.route?.map((point: OriginalIntentJson) => point.route_type === "wire"
      ? { route_type: point.route_type, x: point.x, y: point.y, width: point.width, layer: point.layer }
      : { route_type: point.route_type, x: point.x, y: point.y, from_layer: point.from_layer, to_layer: point.to_layer })
    if (trace.route.length < 2 || canonical.length !== 1 || JSON.stringify(actualGeometry) !== JSON.stringify(expected)) reasons.push("Raw trace is not losslessly represented in final export")
  }
  const exported = circuit.filter((element) => element.type === "pcb_via")
  for (const [index, expected] of expectedExports.entries()) {
    const { site, traceId } = expected
    const via = exported[index]
    if (!via || via.pcb_via_id !== `via_${index}` || via.pcb_trace_id !== traceId || via.x !== site.x || via.y !== site.y ||
      via.outer_diameter !== site.diameter || via.hole_diameter !== site.drill || JSON.stringify(via.layers) !== JSON.stringify(site.layers)) {
      reasons.push("Raw via inventory is not losslessly represented in export")
    } else {
      const linked = traces.find((trace) => trace.pcb_trace_id === via.pcb_trace_id)
      const owner = linked ? owners.traceReference(linked.connection_name) : undefined
      if (owner?.status !== "RESOLVED" || owner.owner !== site.owner) reasons.push("Exported via identity does not prove its raw owner")
    }
  }
  if (exported.length !== expectedExports.length) reasons.push("Unaccounted exported via geometry")
  return { reasons, sites: [...sites.values()] }
}

/** Original SRJ obstacle envelopes are constraints separate from copper checks.
 * Temporary per-segment records serve only the original obstacle predicate;
 * proposals and exports always retain the original raw trace representation.
 */
function checkOriginalSrjObstacles(original: SimpleRouteJson, traces: SimplifiedPcbTrace[], sites: WitnessViaSite[], owners: Pipeline9IntentOwners): number {
  const obstacles = original.obstacles.map((obstacle) => {
    const owner = owners.obstacle(obstacle)
    // Unknown aliases remain hard obstacles. Only an original-declared owner
    // can exempt its own wire geometry under the existing SRJ predicate.
    return { ...obstacle, connectedTo: owner.status === "RESOLVED" ? [owner.owner] : [] }
  })
  if (obstacles.length === 0) return 0
  const routes: HighDensityRoute[] = []
  const stack = original.layerCount === 1 ? ["top"] : ["top", ...Array.from({ length: original.layerCount - 2 }, (_, i) => `inner${i + 1}`), "bottom"]
  for (const trace of traces) {
    const owner = owners.traceReference(trace.connection_name)
    if (owner.status !== "RESOLVED") throw new Error("Generic obstacle check lost original ownership")
    for (let index = 0; index < trace.route.length; index++) {
      const point = trace.route[index]!
      const next = trace.route[index + 1]
      if (point.route_type === "via") {
        const site = sites.find((site) => site.x === point.x && site.y === point.y)
        if (!site) throw new Error("Generic obstacle check lost raw via")
        const manufacturedIndices = site.layers.map((layer) => stack.indexOf(layer))
        routes.push({ connectionName: owner.owner, rootConnectionName: owner.owner, traceThickness: original.minTraceWidth, viaDiameter: site.diameter, vias: [{ x: site.x, y: site.y }], route: [{ x: site.x, y: site.y, z: Math.min(...manufacturedIndices) }, { x: site.x, y: site.y, z: Math.max(...manufacturedIndices) }] })
      } else if (point.route_type === "wire" && next?.route_type === "wire" && point.layer === next.layer) {
        routes.push({ connectionName: owner.owner, rootConnectionName: owner.owner, traceThickness: Math.max(point.width, next.width), viaDiameter: original.minViaDiameter ?? 0.3, vias: [], route: [{ x: point.x, y: point.y, z: stack.indexOf(point.layer) }, { x: next.x, y: next.y, z: stack.indexOf(next.layer) }] })
      }
    }
  }
  return getFixedObstacleViolations({ srj: { ...original, traces: undefined, connections: [], obstacles }, routes }).length
}

/** Reuses the existing raw SRJ via-pad policy with independently resolved
 * original owners. The temporary via records are not exported or rerouted.
 */
function checkOriginalViaPadPolicy(original: SimpleRouteJson, sites: WitnessViaSite[], owners: Pipeline9IntentOwners): number {
  const stack = original.layerCount === 1 ? ["top"] : ["top", ...Array.from({ length: original.layerCount - 2 }, (_, index) => `inner${index + 1}`), "bottom"]
  const routes: HighDensityRoute[] = sites.map((site) => {
    const indices = site.layers.map((layer) => stack.indexOf(layer))
    return { connectionName: site.owner, rootConnectionName: site.owner, traceThickness: original.minTraceWidth, viaDiameter: site.diameter,
      vias: [{ x: site.x, y: site.y }], route: [{ x: site.x, y: site.y, z: Math.min(...indices) }, { x: site.x, y: site.y, z: Math.max(...indices) }] }
  })
  const obstacles = original.obstacles.map((obstacle) => {
    const owner = owners.obstacle(obstacle)
    return { ...obstacle, connectedTo: owner.status === "RESOLVED" ? [owner.owner] : [] }
  })
  return getNewViaPadViolations({ srj: { ...original, traces: undefined, connections: [], obstacles }, previousRoutes: routes, routes,
    viaClearance: getViaToPadClearance(original) ?? 0.1,
    includeExistingVias: routes.map((_, routeIndex) => ({ routeIndex, viaIndex: 0 })) }).length
}

export function getPipeline9WitnessViaCertificate(original: SimpleRouteJson, pointPairs: SimpleRouteJson, traces: SimplifiedPcbTrace[]): WitnessViaCertificate {
  const unsupported: string[] = []
  for (const rule of [original.defaultObstacleMargin, original.minTraceToHoleEdgeClearance, original.minBoardEdgeClearance,
    original.minPlatedHoleDrillEdgeToDrillEdgeClearance, original.minViaEdgeToPadEdgeClearance,
    original.minPadEdgeToPadEdgeClearance, original.minTraceToPadEdgeClearance, original.minViaHoleEdgeToViaHoleEdgeClearance]) {
    if (rule !== undefined && (!Number.isFinite(rule) || rule < 0)) unsupported.push("Invalid explicit physical clearance")
  }
  if (!Number.isFinite(original.minTraceWidth) || original.minTraceWidth <= 0) unsupported.push("Invalid original trace width")
  if (!Number.isSafeInteger(original.layerCount) || original.layerCount < 1 || original.layerCount > 10) unsupported.push("Unsupported original stack")
  if ((original.traces?.length ?? 0) > 0 || traces.some((trace) => trace.__replaces_pcb_trace_id !== undefined)) unsupported.push("Preloaded/replaced copper is outside the experiment scope")
  if (original.obstacles.some((obstacle) => obstacle.circuitJsonMetadata?.pcb_via_id !== undefined)) unsupported.push("Original fixed-via obstacles require a separate lossless inventory")
  if (original.allowViaInPad === true) unsupported.push("Via-in-pad-enabled boards require an independent drill-overlap certificate")
  if (original.minPlatedHoleDrillEdgeToDrillEdgeClearance !== undefined) unsupported.push("Explicit plated-hole drill clearance requires a separate drill certificate")
  if ((original.differentialPairs?.length ?? 0) > 0 || (original.buses?.length ?? 0) > 0 || (original.jumpers?.length ?? 0) > 0) unsupported.push("Additional bus/pair/jumper constraints are outside the experiment scope")
  unsupported.push(...checkBoardEnvelope(original, [], []))
  const supportedLayers = original.layerCount === 1 ? ["top"] : ["top", ...Array.from({ length: Math.max(0, original.layerCount - 2) }, (_, index) => `inner${index + 1}`), "bottom"]
  if (original.obstacles.some((obstacle) => obstacle.layers.length === 0 || obstacle.layers.some((layer) => !supportedLayers.includes(layer)))) unsupported.push("Unsupported original obstacle layers")
  if (original.obstacles.some((obstacle) => {
    const declared = obstacle.layers.map((layer) => supportedLayers.indexOf(layer)).sort((a, b) => a - b)
    const numericLists: unknown[] = [obstacle.zLayers, (obstacle as unknown as { __zLayers?: unknown }).__zLayers]
    return new Set(declared).size !== declared.length || numericLists.some((value) => value !== undefined &&
      (!Array.isArray(value) || value.some((z) => !Number.isSafeInteger(z) || z < 0 || z >= original.layerCount) ||
        JSON.stringify([...value].sort((a, b) => a - b)) !== JSON.stringify(declared)))
  })) unsupported.push("Numeric and named original obstacle layers disagree")
  if (traces.some((trace) => trace.route.some((point) =>
    point.route_type !== "wire" && point.route_type !== "via" ||
    point.route_type === "wire" && (![point.x, point.y, point.width].every(Number.isFinite) || point.width <= 0 || !supportedLayers.includes(point.layer)) ||
    point.route_type === "via" && (![point.x, point.y].every(Number.isFinite) || !supportedLayers.includes(point.from_layer) || !supportedLayers.includes(point.to_layer) ||
      (point.via_diameter !== undefined && (!Number.isFinite(point.via_diameter) || point.via_diameter <= 0)) ||
      (point.via_hole_diameter !== undefined && (!Number.isFinite(point.via_hole_diameter) || point.via_hole_diameter <= 0)) ||
      (point.layers !== undefined && (!Array.isArray(point.layers) || point.layers.length === 0 || point.layers.some((layer) => !supportedLayers.includes(layer)))))))) unsupported.push("Unsupported raw primitive or geometry")
  const wireFields = new Set(["route_type", "x", "y", "width", "layer", "start_pcb_port_id", "end_pcb_port_id"])
  const viaFields = new Set(["route_type", "x", "y", "from_layer", "to_layer", "layers", "via_diameter", "via_hole_diameter"])
  if (traces.some((trace) => trace.route.some((point) => Object.keys(point).some((key) => !(point.route_type === "wire" ? wireFields : viaFields).has(key))))) unsupported.push("Unsupported raw point metadata/geometry fields")
  if (original.connections.some((connection) => connection.pointsToConnect.some((terminal) => {
    const layers = terminal.layers ?? [terminal.layer!]
    return ![terminal.x, terminal.y].every(Number.isFinite) || layers.length === 0 || layers.some((layer) => !supportedLayers.includes(layer)) || (terminal.layers !== undefined && terminal.layer !== undefined)
  }))) unsupported.push("Invalid original terminal layers/geometry")
  if (unsupported.length) return { status: "UNKNOWN", reasons: unsupported, copper: { status: "UNKNOWN", allFindings: [], padOwners: [], viaOwners: [], qualifiedSupportedCopper: false }, referenceErrorCount: -1, demandsChecked: 0, srjObstacleViolationCount: 0, viaInPadViolationCount: 0, viaPadPolicyViolationCount: 0, sites: [], circuitJson: [] }
  const native = evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: pointPairs, routedTraces: traces, includeBoardClearance: true,
    drcOptions: { traceClearance: original.minTraceToPadEdgeClearance ?? 0.1, viaClearance: original.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1 } })
  const circuitJson = native.circuitJson as unknown as OriginalIntentJson[]
  const viaInPadViolationCount = original.allowViaInPad === true ? 0 : checkViasInPads(native.circuitJson).length
  const copper = checkPipeline9OriginalIntentCopper({ original, pointPairs, traces, circuitJson }, {
    viaPad: checkViaPadClearance, padTrace: checkPadTraceClearance, viaTrace: checkViaTraceClearance,
    traceOverlap: checkEachPcbTraceNonOverlapping, differentNetViaSpacing: checkDifferentNetViaSpacing,
    sameNetViaSpacing: checkSameNetViaSpacing, padPad: checkPadPadClearance,
  })
  const owners = new Pipeline9IntentOwners(original, pointPairs)
  const inventory = collectRawViaSites(original, pointPairs, traces, owners, circuitJson)
  const graph = inventory.reasons.length ? { reasons: ["Demand graph requires complete raw inventory"], demands: 0 } : checkDemandGraph(original, traces, owners, copper, circuitJson, inventory.sites)
  const srjObstacleViolationCount = inventory.reasons.length ? 0 : checkOriginalSrjObstacles(original, traces, inventory.sites, owners)
  const viaPadPolicyViolationCount = inventory.reasons.length ? 0 : checkOriginalViaPadPolicy(original, inventory.sites, owners)
  const boardReasons = inventory.reasons.length ? [] : checkBoardEnvelope(original, traces, inventory.sites)
  const structuralBoardReasons = boardReasons.filter((reason) => !reason.includes("exceeds board envelope"))
  const proofReasons = [...inventory.reasons, ...graph.reasons, ...structuralBoardReasons]
  if (copper.ownershipCoverageStatus !== "COMPLETE") proofReasons.push("Original ownership/geometry coverage is incomplete")
  const reasons = [...proofReasons, ...boardReasons.filter((reason) => reason.includes("exceeds board envelope"))]
  if (srjObstacleViolationCount) reasons.push("Original SRJ obstacle-envelope violations remain")
  const complete = proofReasons.length === 0
  return { status: !complete ? "UNKNOWN" : copper.qualifiedSupportedCopper && native.errors.length === 0 && viaInPadViolationCount === 0 && viaPadPolicyViolationCount === 0 && srjObstacleViolationCount === 0 && boardReasons.length === 0 ? "PASS" : "FAIL",
    reasons, copper, referenceErrorCount: native.errors.length, demandsChecked: graph.demands, srjObstacleViolationCount, viaInPadViolationCount, viaPadPolicyViolationCount, sites: inventory.sites, circuitJson }
}
