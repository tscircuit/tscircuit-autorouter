import type { AnyCircuitElement } from "circuit-json"
import type { Obstacle } from "lib/types"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getConnectedCopperPourRepresentatives } from "lib/solvers/EscapeViaLocationSolver/getConnectedCopperPourRepresentatives"

/** SRJ models unbroken pours as net-owned rectangular tiles. Other nets'
 * vias have antipads. Only barrels intersecting the same island on a layer
 * can connect through that pour. No planned access sites are needed.
 */
export function getViasConnectedByCopperPour(
  circuit: AnyCircuitElement[],
  desiredConnectivity: ConnectivityMap,
): string[][] {
  const byNet = new Map<string, Obstacle[]>()
  for (const pour of circuit) {
    if (
      pour.type !== "pcb_copper_pour" ||
      pour.shape !== "rect" ||
      !pour.source_net_id
    )
      continue
    const net = desiredConnectivity.getNetConnectedToId(pour.source_net_id)
    if (!net) continue
    const tiles = byNet.get(net) ?? []
    tiles.push({
      type: "rect",
      center: pour.center,
      width: pour.width,
      height: pour.height,
      ccwRotationDegrees: pour.rotation,
      layers: [pour.layer],
      connectedTo: [pour.source_net_id],
    })
    byNet.set(net, tiles)
  }
  if (!byNet.size) return []
  const islandsByNet = new Map(
    Array.from(
      byNet,
      ([net, tiles]) =>
        [net, getConnectedCopperPourRepresentatives(tiles)] as const,
    ),
  )
  const viasByIsland = new Map<Obstacle, Set<string>>()
  for (const via of circuit) {
    if (
      via.type !== "pcb_via" ||
      !(via.outer_diameter > via.hole_diameter && via.hole_diameter > 0)
    )
      continue
    const net = desiredConnectivity.getNetConnectedToId(via.pcb_via_id)
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
