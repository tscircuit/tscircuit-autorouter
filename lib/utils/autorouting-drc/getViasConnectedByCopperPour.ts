import type { AnyCircuitElement } from "circuit-json"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getConnectedCopperPourRepresentatives } from "lib/solvers/EscapeViaLocationSolver/getConnectedCopperPourRepresentatives"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

/** SRJ models unbroken pours as net-owned rectangular tiles. Other nets'
 * vias have antipads. Only barrels intersecting the same island on a layer
 * can connect through that pour. No planned access sites are needed.
 */
export function getViasConnectedByCopperPour(
  srj: SimpleRouteJson,
  circuit: AnyCircuitElement[],
): string[][] {
  const pours = srj.obstacles.filter((o) => o.isCopperPour)
  if (!pours.length) return []
  const netAliases = getConnectivityMapFromSimpleRouteJson(srj)
  const byNet = new Map<string, Obstacle[]>()
  for (const pour of pours) {
    const [owner] = pour.connectedTo
    const net = owner && netAliases.getNetConnectedToId(owner)
    if (!net) continue
    const tiles = byNet.get(net) ?? []
    for (const layer of pour.layers) tiles.push({ ...pour, layers: [layer] })
    byNet.set(net, tiles)
  }
  const islandsByNet = new Map(
    Array.from(
      byNet,
      ([net, tiles]) =>
        [net, getConnectedCopperPourRepresentatives(tiles)] as const,
    ),
  )
  const traceOwners = new Map<string, string>()
  for (const e of circuit) {
    if (e.type === "pcb_trace" && e.source_trace_id)
      traceOwners.set(e.pcb_trace_id, e.source_trace_id)
  }
  const viasByIsland = new Map<Obstacle, Set<string>>()
  for (const via of circuit) {
    if (
      via.type !== "pcb_via" ||
      !(via.outer_diameter > via.hole_diameter && via.hole_diameter > 0)
    )
      continue
    const owner =
      via.source_net_id ??
      via.source_trace_id ??
      (via.pcb_trace_id && traceOwners.get(via.pcb_trace_id))
    const net = owner && netAliases.getNetConnectedToId(owner)
    const islands = net && islandsByNet.get(net)
    if (!islands) continue
    const layers: readonly string[] = via.layers
    for (const [tile, island] of islands) {
      if (!layers.includes(tile.layers[0]!)) continue
      const angle = ((tile.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const dx = via.x - tile.center.x,
        dy = via.y - tile.center.y
      const x = Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle))
      const y = Math.abs(dy * Math.cos(angle) - dx * Math.sin(angle))
      const w = tile.width / 2,
        h = tile.height / 2
      // The tile must reach inside the barrel’s outer radius and outside its drill.
      if (
        Math.hypot(Math.max(0, x - w), Math.max(0, y - h)) >=
          via.outer_diameter / 2 ||
        Math.hypot(x + w, y + h) <= via.hole_diameter / 2
      )
        continue
      const ids = viasByIsland.get(island) ?? new Set<string>()
      ids.add(via.pcb_via_id)
      viasByIsland.set(island, ids)
    }
  }
  return Array.from(viasByIsland.values())
    .filter((ids) => ids.size > 1)
    .map((ids) => [...ids])
}
