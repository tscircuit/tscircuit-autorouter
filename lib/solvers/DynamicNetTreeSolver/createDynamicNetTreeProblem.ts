import type { SimpleRouteJson, SimplifiedPcbTrace, Obstacle } from "../../types"
import { mapLayerNameToZ } from "../../utils/mapLayerNameToZ"
import type { DynamicNetTreeProblem } from "./routeDynamicNetTree"
import type { TreeCopper } from "./dynamicNetTreeGeometry"

export type PostRoutingObstacle = Obstacle & {
  isPlated?: boolean
  holeDiameter?: number
}
export type PostRoutingPhysicalInput = Omit<SimpleRouteJson, "obstacles"> & {
  obstacles: PostRoutingObstacle[]
}

/** Explicit name-to-net associations only. No coordinate hashes, prefixes, or
 * substring matching can make foreign copper exempt from clearance. */
export function createDynamicNetTreeProblem(
  srj: PostRoutingPhysicalInput,
  net: string,
  fixedTraces: SimplifiedPcbTrace[],
  traceOwners: ReadonlyMap<string, string>,
): DynamicNetTreeProblem {
  if (
    srj.layerCount !== 2 ||
    srj.differentialPairs?.length ||
    srj.buses?.length ||
    srj.allowJumpers ||
    srj.jumpers?.length ||
    srj.allowBlindAndBuriedVias
  )
    throw new Error(
      "Post-routing net-tree supports ordinary two-layer nets only",
    )
  const connection = srj.connections.find((c) => c.name === net)
  if (!connection) throw new Error(`Unknown net ${net}`)
  const owners = new Map<string, string>()
  for (const c of srj.connections) {
    if (
      c.pointsToConnect.some((p) => "terminalVia" in p && p.terminalVia) ||
      c.externallyConnectedPointIds?.length
    )
      throw new Error(`Unsupported terminal/external constraint ${c.name}`)
    if (c.isOffBoard) throw new Error(`Unsupported off-board net ${c.name}`)
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
    if (
      obstacle.isCopperPour ||
      obstacle.offBoardConnectsTo?.length ||
      obstacle.isNonPlatedHole ||
      obstacle.netIsAssignable
    )
      throw new Error(`Unsupported plane/external copper ${index}`)
    const matched = new Set(
      obstacle.connectedTo
        .map((id) => owners.get(id))
        .filter((owner): owner is string => Boolean(owner)),
    )
    if (matched.size > 1)
      throw new Error(`Obstacle ${index} has conflicting physical ownership`)
    const owner = matched.size ? [...matched][0]! : `unassigned:${index}`
    if (obstacle.layers.some((layer) => layer !== "top" && layer !== "bottom"))
      throw new Error(`Unsupported obstacle layer ${index}`)
    const activeLayers = obstacle.layers.map((layer) =>
      mapLayerNameToZ(layer, 2),
    )
    if (activeLayers.length === 0) continue
    const model = obstacle as Omit<typeof obstacle, "type"> & {
      type: string
      holeDiameter?: number
    }
    const rotation = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    if (activeLayers.length > 1 && obstacle.isPlated === undefined)
      throw new Error(
        `Multilayer pad ${index} requires explicit isPlated metadata`,
      )
    if (
      obstacle.isPlated !== undefined &&
      typeof obstacle.isPlated !== "boolean"
    )
      throw new Error(`Invalid plating metadata ${index}`)
    const plated = obstacle.isPlated === true
    // Multiple unplated pad layers do not imply a plated interlayer bridge.
    if (
      plated &&
      (!Number.isFinite(model.holeDiameter) ||
        !model.holeDiameter ||
        model.holeDiameter <= 0)
    )
      throw new Error(
        `Plated pad ${index} requires explicit holeDiameter for drill checks`,
      )
    if (plated && activeLayers.length !== 2)
      throw new Error(`Plated pad ${index} must span both supported layers`)
    if (!plated && model.holeDiameter)
      throw new Error(
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
      }
      if (obstacle.shape === "circle" || model.type === "oval") {
        const major = Math.max(obstacle.width, obstacle.height),
          minor = Math.min(obstacle.width, obstacle.height)
        if (obstacle.shape === "circle" && Math.abs(major - minor) > 1e-8)
          throw new Error(`Unsupported elliptical pad ${index}`)
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
      } else if (model.type === "rect")
        c.rectangle = {
          width: obstacle.width,
          height: obstacle.height,
          rotation,
        }
      else throw new Error(`Unsupported pad geometry ${model.type}`)
      // Explicit drill metadata is needed to check new drills against pads.
      if (plated && model.holeDiameter) c.holeDiameter = model.holeDiameter
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
      if (p.route_type === "via")
        copper.push({
          id: `${trace.pcb_trace_id}:via:${i}`,
          owner,
          layers: [0, 1],
          start: p,
          end: p,
          radius:
            (p.via_diameter ??
              srj.minViaPadDiameter ??
              srj.min_via_pad_diameter ??
              srj.minViaDiameter ??
              0.6) / 2,
          holeDiameter:
            p.via_hole_diameter ??
            srj.minViaHoleDiameter ??
            srj.min_via_hole_diameter ??
            0.3,
          kind: "via",
        })
      else if (p.route_type === "wire") {
        const next = trace.route[i + 1]
        if (
          next?.route_type === "wire" &&
          p.layer === next.layer &&
          Math.hypot(next.x - p.x, next.y - p.y) > 1e-9
        )
          copper.push({
            id: `${trace.pcb_trace_id}:wire:${i}`,
            owner,
            layers: [mapLayerNameToZ(p.layer, 2)],
            start: p,
            end: next,
            radius: Math.max(p.width, next.width) / 2,
            kind: "wire",
          })
      } else
        throw new Error(`Unsupported fixed trace primitive ${p.route_type}`)
    }
  }
  const b = srj.bounds
  return {
    net,
    terminals: connection.pointsToConnect.map((p, i) => ({
      id: p.pcb_port_id ?? p.pointId ?? `${net}:${i}`,
      point: { x: p.x, y: p.y },
      layers: (p.layers ?? [p.layer!]).map((layer) =>
        mapLayerNameToZ(layer, 2),
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
    clearance: Math.max(
      srj.minTraceToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0.2,
      srj.minViaEdgeToPadEdgeClearance ?? 0,
    ),
    boardEdgeClearance: srj.minBoardEdgeClearance ?? 0.2,
    viaDiameter:
      srj.minViaPadDiameter ??
      srj.min_via_pad_diameter ??
      srj.minViaDiameter ??
      0.6,
    viaHoleDiameter: srj.minViaHoleDiameter ?? srj.min_via_hole_diameter ?? 0.3,
    holeClearance: Math.max(
      srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
      srj.minPlatedHoleDrillEdgeToDrillEdgeClearance ?? 0,
    ),
    allowViaInPad: srj.allowViaInPad ?? false,
  }
}
