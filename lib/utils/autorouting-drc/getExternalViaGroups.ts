import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type Site = {
  x: number
  y: number
  layer: string
  toLayer: string
  net: string
}

/** Resolve declared plane access groups against the barrels actually present in each candidate. */
export function getExternalViaGroups(
  srj: SimpleRouteJson,
): (elements: AnyCircuitElement[]) => string[][] {
  const sites = new Map<string, Site>()
  const groups = new Map<string, string[]>()
  for (const c of srj.connections) {
    for (const ids of c.externallyConnectedPointIds ?? [])
      groups.set(JSON.stringify(ids), ids)
    for (const p of c.pointsToConnect) {
      if (!p.pointId || !p.layer || !p.terminalVia) continue
      sites.set(p.pointId, {
        x: p.x,
        y: p.y,
        layer: p.layer,
        toLayer: p.terminalVia.toLayer,
        net: c.name,
      })
    }
  }
  if (!groups.size || !sites.size) return () => []
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  return (elements): string[][] => {
    const traces = new Map(
      elements.flatMap((e) =>
        e.type === "pcb_trace"
          ? [[e.pcb_trace_id, e.source_trace_id] as const]
          : [],
      ),
    )
    const vias = elements.filter(
      (e): e is Extract<AnyCircuitElement, { type: "pcb_via" }> =>
        e.type === "pcb_via" && e.outer_diameter > 0,
    )
    if (!vias.length) return []
    const sitesByLocation = new FlatbushIndex<(typeof vias)[number]>(
      vias.length,
    )
    for (const via of vias)
      sitesByLocation.insert(via, via.x, via.y, via.x, via.y)
    sitesByLocation.finish()
    return [...groups.values()]
      .map((ids) =>
        ids.flatMap((id) => {
          const site = sites.get(id)
          if (!site) return []
          const candidates = sitesByLocation.search(
            site.x - 1e-6,
            site.y - 1e-6,
            site.x + 1e-6,
            site.y + 1e-6,
          )
          return candidates.flatMap((via) => {
            const layers: readonly string[] = via.layers
            if (
              !via.pcb_trace_id ||
              !layers.includes(site.layer) ||
              !layers.includes(site.toLayer)
            )
              return []
            const owner = traces.get(via.pcb_trace_id)
            if (
              !owner ||
              (owner !== site.net && !connMap.areIdsConnected(owner, site.net))
            )
              return []
            return [via.pcb_via_id]
          })
        }),
      )
      .filter((ids) => ids.length > 1)
  }
}
