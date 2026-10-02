import type { SimpleRouteJson, SimplifiedPcbTrace, Obstacle } from "../../types"
import { postRoutingLayerIndex, postRoutingViaLayers } from "./postRoutingLayers"
import type { DynamicNetTreeProblem } from "./routeDynamicNetTree"
import type { TreeCopper } from "./dynamicNetTreeGeometry"
import { segmentCopperGap } from "./dynamicNetTreeGeometry"
import { UnsupportedPostRoutingInputError } from "../PostRoutingOptimization/UnsupportedPostRoutingInputError"
import { getViaDimensions } from "../../utils/getViaDimensions"

export type PostRoutingObstacle = Obstacle & {
  isPlated?: boolean
  holeDiameter?: number
  /** Source-backed slots are retained explicitly and are currently unsupported. */
  holeShape?: "circle" | "slot"
  cornerRadius?: number
  /** Exact source land inside the SRJ producer's retained obstacle envelope. */
  landShape?: "rect" | "circle" | "oval"
  sourceHoleId?: string
  routingEnvelope?: { width: number; height: number; rotation: number }
  /** Authoritative source geometry that the current validator cannot model. */
  unsupportedPhysicalGeometry?: string
}
export type PostRoutingPhysicalInput = Omit<SimpleRouteJson, "obstacles"> & {
  obstacles: PostRoutingObstacle[]
  unsupportedPhysicalGeometry?: string
}

/** Explicit name-to-net associations only. No coordinate hashes, prefixes, or
 * substring matching can make foreign copper exempt from clearance. */
export function createDynamicNetTreeProblem(
  srj: PostRoutingPhysicalInput,
  net: string,
  fixedTraces: SimplifiedPcbTrace[],
  traceOwners: ReadonlyMap<string, string>,
): DynamicNetTreeProblem {
  const viaDimensions = getViaDimensions(srj)
  if (srj.unsupportedPhysicalGeometry)
    throw new UnsupportedPostRoutingInputError(srj.unsupportedPhysicalGeometry)
  if (
    srj.differentialPairs?.length ||
    srj.buses?.length ||
    srj.allowJumpers ||
    srj.jumpers?.length
  )
    throw new UnsupportedPostRoutingInputError(
      "Post-routing net-tree does not support differential, bus or jumper constraints",
    )
  const connection = srj.connections.find((c) => c.name === net)
  if (!connection) throw new Error(`Unknown net ${net}`)
  const owners = new Map<string, string>()
  for (const c of srj.connections) {
    if (
      c.pointsToConnect.some((p) => "terminalVia" in p && p.terminalVia) ||
      c.externallyConnectedPointIds?.length
    )
      throw new UnsupportedPostRoutingInputError(
        `Unsupported terminal/external constraint ${c.name}`,
      )
    if (c.isOffBoard)
      throw new UnsupportedPostRoutingInputError(
        `Unsupported off-board net ${c.name}`,
      )
    for (const id of [
      c.name,
      c.source_trace_id,
      c.rootConnectionName,
      c.netConnectionName,
      c.__netConnectionName,
      ...(c.mergedConnectionNames ?? []),
      ...(c.__rootConnectionNames ?? []),
      ...c.pointsToConnect
        .flatMap((p) => [p.pointId, p.pcb_port_id])
        .filter((id): id is string => Boolean(id)),
    ].filter((id): id is string => Boolean(id))) {
      if (owners.has(id) && owners.get(id) !== c.name)
        throw new Error(`Conflicting explicit owner of ${id}`)
      owners.set(id, c.name)
    }
  }
  const copper: TreeCopper[] = []
  for (const [index, obstacle] of srj.obstacles.entries()) {
    if (obstacle.unsupportedPhysicalGeometry)
      throw new UnsupportedPostRoutingInputError(
        `Unsupported pad geometry ${index}: ${obstacle.unsupportedPhysicalGeometry}`,
      )
    if (
      obstacle.isCopperPour ||
      obstacle.offBoardConnectsTo?.length ||
      obstacle.netIsAssignable
    )
      throw new UnsupportedPostRoutingInputError(
        `Unsupported plane/external copper ${index}`,
      )
    if (obstacle.isNonPlatedHole) {
      if (!obstacle.sourceHoleId || obstacle.connectedTo.length ||
        obstacle.holeShape !== "circle" || !obstacle.holeDiameter)
        throw new UnsupportedPostRoutingInputError(`Non-plated hole ${index} needs explicit source-backed geometry`)
      const layers = Array.from({ length: srj.layerCount }, (_, z) => z)
      copper.push({ id: `hole:${obstacle.sourceHoleId}`, owner: `unassigned-hole:${obstacle.sourceHoleId}`,
        layers, start: obstacle.center, end: obstacle.center, radius: obstacle.holeDiameter / 2,
        kind: "hole", holeDiameter: obstacle.holeDiameter,
        drill: {start: obstacle.center, end: obstacle.center, diameter: obstacle.holeDiameter, layers} })
      continue
    }
    const matched = new Set(
      obstacle.connectedTo
        .map((id) => owners.get(id))
        .filter((owner): owner is string => Boolean(owner)),
    )
    if (matched.size > 1)
      throw new Error(`Obstacle ${index} has conflicting physical ownership`)
    const owner = matched.size ? [...matched][0]! : `unassigned:${index}`
    const activeLayers = obstacle.layers.map((layer) =>
      postRoutingLayerIndex(layer, srj.layerCount),
    )
    if (activeLayers.length === 0) continue
    const model = obstacle as Omit<typeof obstacle, "type"> & {
      type: string
      holeDiameter?: number
    }
    const shape = obstacle.landShape ??
      (obstacle.shape === "circle" ? "circle" : model.type)
    const rotation = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    if (activeLayers.length > 1 && obstacle.isPlated === undefined)
      throw new UnsupportedPostRoutingInputError(
        `Multilayer pad ${index} requires explicit isPlated metadata`,
      )
    if (
      obstacle.isPlated !== undefined &&
      typeof obstacle.isPlated !== "boolean"
    )
      throw new Error(`Invalid plating metadata ${index}`)
    const plated = obstacle.isPlated === true
    if (obstacle.holeShape === "slot")
      throw new UnsupportedPostRoutingInputError(
        `Unsupported slotted drill ${index}`,
      )
    // Multiple unplated pad layers do not imply a plated interlayer bridge.
    if (
      plated &&
      (!Number.isFinite(model.holeDiameter) ||
        !model.holeDiameter ||
        model.holeDiameter <= 0)
    )
      throw new UnsupportedPostRoutingInputError(
        `Plated pad ${index} requires explicit holeDiameter for drill checks`,
      )
    if (plated && (activeLayers.length < 2 ||
      [...activeLayers].sort((a, b) => a - b).some((z, i, layers) =>
        i > 0 && z !== layers[i - 1]! + 1)))
      throw new Error(`Plated pad ${index} must have a contiguous physical span`)
    if (!plated && model.holeDiameter)
      throw new UnsupportedPostRoutingInputError(
        `Unplated drilled pad ${index} requires a supported hole adapter`,
      )
    const groups = plated ? [activeLayers] : activeLayers.map((z) => [z])
    for (const [group, layers] of groups.entries()) {
      const c: TreeCopper = {
        id: `pad:${index}:${group}`,
        owner,
        layers,
        start: obstacle.center,
        end: obstacle.center,
        radius: 0,
        kind: "pad",
        sourcePadId: obstacle.circuitJsonMetadata?.pcb_plated_hole_id ??
          obstacle.circuitJsonMetadata?.pcb_smtpad_id,
        routingEnvelope: obstacle.routingEnvelope,
      }
      if (shape === "circle" || shape === "oval") {
        const major = Math.max(obstacle.width, obstacle.height),
          minor = Math.min(obstacle.width, obstacle.height)
        if (shape === "circle" && Math.abs(major - minor) > 1e-8)
          throw new UnsupportedPostRoutingInputError(
            `Unsupported elliptical pad ${index}`,
          )
        const angle =
            rotation + (obstacle.width < obstacle.height ? Math.PI / 2 : 0),
          d = (major - minor) / 2
        c.start = {
          x: obstacle.center.x - Math.cos(angle) * d,
          y: obstacle.center.y - Math.sin(angle) * d,
        }
        c.end = {
          x: obstacle.center.x + Math.cos(angle) * d,
          y: obstacle.center.y + Math.sin(angle) * d,
        }
        c.radius = minor / 2
      } else if (shape === "rect") {
        c.radius = obstacle.cornerRadius ?? 0
        if (!Number.isFinite(c.radius) || c.radius < 0 ||
          c.radius > Math.min(obstacle.width, obstacle.height) / 2)
          throw new Error(`Invalid rounded pad ${index}`)
        c.rectangle = {
          width: obstacle.width - 2 * c.radius,
          height: obstacle.height - 2 * c.radius,
          rotation,
        }
      } else
        throw new UnsupportedPostRoutingInputError(
          `Unsupported pad geometry ${shape}`,
        )
      // Explicit drill metadata is needed to check new drills against pads.
      if (plated && model.holeDiameter) {
        c.holeDiameter = model.holeDiameter
        c.drill = { start: obstacle.center, end: obstacle.center,
          diameter: model.holeDiameter, layers: activeLayers }
      }
      copper.push(c)
    }
  }
  for (const trace of fixedTraces) {
    const owner = traceOwners.get(trace.connection_name)
    if (!owner || !srj.connections.some((c) => c.name === owner))
      throw new Error(
        `Fixed trace ${trace.pcb_trace_id} needs an explicit valid owner`,
      )
    for (const [i, p] of trace.route.entries()) {
      if (p.route_type === "via") {
        const layers = postRoutingViaLayers(srj, p)
        const diameter = p.via_hole_diameter ?? viaDimensions.holeDiameter
        copper.push({
          id: `${trace.pcb_trace_id}:via:${i}`,
          owner,
          layers,
          start: p,
          end: p,
          radius: (p.via_diameter ?? viaDimensions.padDiameter) / 2,
          holeDiameter: diameter,
          drill: { start: p, end: p, diameter, layers },
          kind: "via",
        })
      } else if (p.route_type === "wire") {
        const next = trace.route[i + 1]
        if (
          next?.route_type === "wire" &&
          p.layer === next.layer &&
          Math.hypot(next.x - p.x, next.y - p.y) > 1e-9
        )
          copper.push({
            id: `${trace.pcb_trace_id}:wire:${i}`,
            owner,
            layers: [postRoutingLayerIndex(p.layer, srj.layerCount)],
            start: p,
            end: next,
            radius: Math.max(p.width, next.width) / 2,
            kind: "wire",
          })
      } else if (p.route_type === "through_obstacle") {
        const id = p.circuitJsonMetadata?.pcb_plated_hole_id
        const from = postRoutingLayerIndex(p.from_layer, srj.layerCount)
        const to = postRoutingLayerIndex(p.to_layer, srj.layerCount)
        const land = id ? copper.find(c => c.kind === "pad" && c.sourcePadId === id && c.drill) : undefined
        if (!id || !land)
          throw new UnsupportedPostRoutingInputError(`Unproven plated traversal ${trace.pcb_trace_id}:${i}`)
        if (land.owner !== owner || !land.layers.includes(from) || !land.layers.includes(to) ||
          segmentCopperGap(p.start, p.start, land) > 1e-8 ||
          segmentCopperGap(p.end, p.end, land) > 1e-8)
          throw new Error(`Invalid physical plated traversal ${trace.pcb_trace_id}:${i}`)
        // The immutable source pad already supplies this physical connection.
        // This marker adds neither a wire shortcut nor a new drilled barrel.
      } else
        throw new UnsupportedPostRoutingInputError(
          `Unsupported fixed trace primitive ${p.route_type}`,
        )
    }
  }
  const b = srj.bounds
  return {
    net,
    layerCount: srj.layerCount,
    allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias ?? false,
    terminals: connection.pointsToConnect.map((p, i) => ({
      id: p.pcb_port_id ?? p.pointId ?? `${net}:${i}`,
      point: { x: p.x, y: p.y },
      layers: (p.layers ?? [p.layer!]).map((layer) =>
        postRoutingLayerIndex(layer, srj.layerCount),
      ),
    })),
    copper,
    bounds: b,
    outline: srj.outline ?? [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ],
    width: Math.max(
      srj.minTraceWidth,
      connection.nominalTraceWidth ??
        connection.width ??
        srj.nominalTraceWidth ??
        srj.minTraceWidth,
    ),
    // Match Pipeline9's declared-rule validation defaults. A routing margin is
    // retained when supplied; do not introduce a larger manufacturing rule.
    clearance: Math.max(srj.minTraceToPadEdgeClearance ?? 0.1,
      srj.defaultObstacleMargin ?? 0),
    viaToPadClearance: Math.max(0.1, srj.minViaEdgeToPadEdgeClearance ?? 0,
      srj.defaultObstacleMargin ?? 0),
    traceToHoleClearance: srj.minTraceToHoleEdgeClearance ?? 0.2,
    platedHoleClearance: srj.minPlatedHoleDrillEdgeToDrillEdgeClearance ?? 0,
    boardEdgeClearance: srj.minBoardEdgeClearance ?? 0,
    viaDiameter: viaDimensions.padDiameter,
    viaHoleDiameter: viaDimensions.holeDiameter,
    holeClearance: Math.max(
      srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
      srj.minPlatedHoleDrillEdgeToDrillEdgeClearance ?? 0,
    ),
    allowViaInPad: srj.allowViaInPad ?? false,
  }
}
