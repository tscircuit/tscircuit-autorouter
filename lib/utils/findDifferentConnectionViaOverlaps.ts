import type { SimplifiedPcbTraces } from "lib/types"
import type { ConnectivityLookup } from "lib/utils/findSameLayerDifferentConnectionCrossings"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

export const DEFAULT_VIA_TO_VIA_CLEARANCE = 0.1

export type ViaOverlap = {
  layer: string
  x: number
  y: number
  distance: number
  minCenterDistance: number
  traceAId: string
  traceBId: string
  connectionA: string
  connectionB: string
}

type ViaPad = {
  x: number
  y: number
  diameter: number
  layers: string[]
  traceId: string
  connectionName: string
}

export type ViaOverlapOptions = {
  connMap?: ConnectivityLookup | null
  layerCount?: number
  defaultViaDiameter?: number
  viaClearance?: number
}

function tracesAreSameConnection(
  a: ViaPad,
  b: ViaPad,
  connMap?: ConnectivityLookup | null,
): boolean {
  if (a.traceId === b.traceId) return true
  if (
    a.connectionName &&
    b.connectionName &&
    a.connectionName === b.connectionName
  ) {
    return true
  }
  if (!connMap) return false

  const idsA = [a.traceId, a.connectionName].filter(Boolean)
  const idsB = [b.traceId, b.connectionName].filter(Boolean)
  for (const idA of idsA) {
    for (const idB of idsB) {
      try {
        if (connMap.areIdsConnected(idA, idB)) return true
      } catch {
        // Connectivity maps can throw on unknown ids; treat as disconnected.
      }
    }
  }
  return false
}

function layerIndex(layer: string, layerCount: number): number | null {
  if (layer === "top") return 0
  if (layer === "bottom") return Math.max(layerCount - 1, 0)
  const inner = /^inner(\d+)$/.exec(layer)
  if (!inner) return null
  return Number(inner[1])
}

/** Layers the via barrel occupies, including inner layers between from/to. */
export function layersOccupiedByVia(
  fromLayer: string,
  toLayer: string,
  layerCount: number,
): string[] {
  const fromZ = layerIndex(fromLayer, layerCount)
  const toZ = layerIndex(toLayer, layerCount)
  if (fromZ === null || toZ === null) {
    return Array.from(new Set([fromLayer, toLayer]))
  }
  const lo = Math.min(fromZ, toZ)
  const hi = Math.max(fromZ, toZ)
  const layers: string[] = []
  for (let z = lo; z <= hi; z++) {
    try {
      layers.push(mapZToLayerName(z, layerCount))
    } catch {
      // Skip z values the board does not name.
    }
  }
  return layers.length > 0 ? layers : [fromLayer, toLayer]
}

function sharedLayer(a: ViaPad, b: ViaPad): string | null {
  for (const layer of a.layers) {
    if (b.layers.includes(layer)) return layer
  }
  return null
}

function collectVias(
  traces: SimplifiedPcbTraces,
  layerCount: number,
  defaultViaDiameter: number,
): ViaPad[] {
  const vias: ViaPad[] = []
  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      vias.push({
        x: point.x,
        y: point.y,
        diameter: point.via_diameter ?? defaultViaDiameter,
        layers: layersOccupiedByVia(
          point.from_layer,
          point.to_layer,
          layerCount,
        ),
        traceId: trace.pcb_trace_id,
        connectionName: trace.connection_name,
      })
    }
  }
  return vias
}

/**
 * Detects different-connection via pads that violate center spacing on a
 * shared layer. Intermediate layers between from/to are treated as occupied
 * so a top→inner2 via shorts an inner1→top neighbor on both top and inner1.
 */
export function findDifferentConnectionViaOverlaps(
  traces: SimplifiedPcbTraces,
  opts: ViaOverlapOptions = {},
): ViaOverlap[] {
  const layerCount = opts.layerCount ?? 4
  const defaultViaDiameter = opts.defaultViaDiameter ?? 0.6
  const viaClearance = opts.viaClearance ?? DEFAULT_VIA_TO_VIA_CLEARANCE
  const vias = collectVias(traces, layerCount, defaultViaDiameter)
  const overlaps: ViaOverlap[] = []
  const seen = new Set<string>()

  for (let i = 0; i < vias.length; i++) {
    for (let j = i + 1; j < vias.length; j++) {
      const a = vias[i]!
      const b = vias[j]!
      if (tracesAreSameConnection(a, b, opts.connMap)) continue
      const layer = sharedLayer(a, b)
      if (!layer) continue

      const dx = a.x - b.x
      const dy = a.y - b.y
      const distance = Math.hypot(dx, dy)
      const minCenterDistance = a.diameter / 2 + b.diameter / 2 + viaClearance
      if (distance + 1e-9 >= minCenterDistance) continue

      const key = [
        layer,
        [a.traceId, b.traceId].sort().join("|"),
        Math.round(((a.x + b.x) / 2) * 1e6),
        Math.round(((a.y + b.y) / 2) * 1e6),
      ].join(":")
      if (seen.has(key)) continue
      seen.add(key)

      overlaps.push({
        layer,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        distance,
        minCenterDistance,
        traceAId: a.traceId,
        traceBId: b.traceId,
        connectionA: a.connectionName,
        connectionB: b.connectionName,
      })
    }
  }

  return overlaps
}

export function getDifferentConnectionViaOverlapFailure(
  traces: SimplifiedPcbTraces,
  opts: ViaOverlapOptions = {},
): string | null {
  const overlaps = findDifferentConnectionViaOverlaps(traces, opts)
  if (overlaps.length === 0) return null
  const first = overlaps[0]!
  const extra = overlaps.length > 1 ? ` (${overlaps.length} overlaps)` : ""
  return (
    `Different-connection via pads overlap at (${first.x.toFixed(3)}, ${first.y.toFixed(3)}) ` +
    `layer=${first.layer} dist=${first.distance.toFixed(3)} < ${first.minCenterDistance.toFixed(3)}: ` +
    `${first.traceAId} x ${first.traceBId}${extra}`
  )
}
