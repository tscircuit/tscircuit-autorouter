import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

export const DEFAULT_VIA_TO_PAD_CLEARANCE = 0.1

export type AutorouterOutputViolationType =
  | "via_overlaps_unrelated_pad"
  | "via_in_connected_pad"

export type AutorouterOutputViolation = {
  type: AutorouterOutputViolationType
  connectionName: string
  pcbTraceId: string
  via: { x: number; y: number; diameter: number; layers: string[] }
  pad: {
    center: { x: number; y: number }
    width: number
    height: number
    layers: string[]
    connectedTo: string[]
  }
  gap: number
  minClearance: number
}

export type ValidateSimpleRouteJsonOutputOptions = {
  minClearance?: number
}

type ViaPad = {
  x: number
  y: number
  diameter: number
  layers: string[]
  pcbTraceId: string
  connectionName: string
  connectsTo: string[]
}

const layersOccupiedByVia = (
  fromLayer: string,
  toLayer: string,
  layerCount: number,
): string[] => {
  const fromZ = mapLayerNameToZ(fromLayer, layerCount)
  const toZ = mapLayerNameToZ(toLayer, layerCount)
  if (!Number.isFinite(fromZ) || !Number.isFinite(toZ)) {
    return Array.from(new Set([fromLayer, toLayer]))
  }
  const lo = Math.min(fromZ, toZ)
  const hi = Math.max(fromZ, toZ)
  const layers: string[] = []
  for (let z = lo; z <= hi; z++) {
    layers.push(mapZToLayerName(z, layerCount))
  }
  return layers
}

const sharedLayer = (
  viaLayers: string[],
  padLayers: string[],
): string | null => {
  for (const layer of viaLayers) {
    if (padLayers.includes(layer)) return layer
  }
  return null
}

/**
 * Signed gap from a circle to an axis-aligned rectangle: negative means overlap.
 */
export const signedGapCircleToAabb = ({
  cx,
  cy,
  radius,
  center,
  width,
  height,
}: {
  cx: number
  cy: number
  radius: number
  center: { x: number; y: number }
  width: number
  height: number
}): number => {
  const halfW = width / 2
  const halfH = height / 2
  const dx = Math.abs(cx - center.x)
  const dy = Math.abs(cy - center.y)
  const insideX = dx <= halfW
  const insideY = dy <= halfH
  if (insideX && insideY) {
    return -radius
  }
  const outsideX = Math.max(dx - halfW, 0)
  const outsideY = Math.max(dy - halfH, 0)
  return Math.hypot(outsideX, outsideY) - radius
}

const viaIds = (via: ViaPad): Set<string> =>
  new Set(
    [via.connectionName, via.pcbTraceId, ...via.connectsTo].filter(Boolean),
  )

const isConnectedPad = (via: ViaPad, pad: Obstacle): boolean => {
  const ids = viaIds(via)
  return pad.connectedTo.some((id) => ids.has(id))
}

const collectVias = (
  traces: SimplifiedPcbTrace[],
  layerCount: number,
  defaultViaDiameter: number,
): ViaPad[] => {
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
        pcbTraceId: trace.pcb_trace_id,
        connectionName: trace.connection_name,
        connectsTo: trace.connectsTo ?? [],
      })
    }
  }
  return vias
}

/**
 * Validate autorouter output (including traces mutated after solve) against
 * pad obstacles. Callers can run this after custom post-processing.
 *
 * - Unrelated pads: via copper must stay at least `minClearance` (default 0.1 mm)
 *   away, matching typical DRC.
 * - Connected pads: flagged only when `allowViaInPad` is not true and the via
 *   center is inside the pad.
 */
export function validateSimpleRouteJsonOutput(
  srj: SimpleRouteJson,
  opts: ValidateSimpleRouteJsonOutputOptions = {},
): AutorouterOutputViolation[] {
  const traces = srj.traces ?? []
  if (traces.length === 0) return []

  const minClearance =
    opts.minClearance ??
    srj.minViaEdgeToPadEdgeClearance ??
    DEFAULT_VIA_TO_PAD_CLEARANCE
  const defaultViaDiameter = getViaDimensions(srj).padDiameter
  const vias = collectVias(traces, srj.layerCount, defaultViaDiameter)
  const pads = srj.obstacles.filter(
    (obstacle) => obstacle.type === "rect" && !obstacle.isCopperPour,
  )

  const violations: AutorouterOutputViolation[] = []
  const allowViaInPad = srj.allowViaInPad === true

  for (const via of vias) {
    const radius = via.diameter / 2
    for (const pad of pads) {
      if (!sharedLayer(via.layers, pad.layers)) continue
      const gap = signedGapCircleToAabb({
        cx: via.x,
        cy: via.y,
        radius,
        center: pad.center,
        width: pad.width,
        height: pad.height,
      })
      const connected = isConnectedPad(via, pad)

      if (connected) {
        if (allowViaInPad) continue
        if (gap > -radius + 1e-9) continue
        violations.push({
          type: "via_in_connected_pad",
          connectionName: via.connectionName,
          pcbTraceId: via.pcbTraceId,
          via: {
            x: via.x,
            y: via.y,
            diameter: via.diameter,
            layers: via.layers,
          },
          pad: {
            center: pad.center,
            width: pad.width,
            height: pad.height,
            layers: pad.layers,
            connectedTo: pad.connectedTo,
          },
          gap,
          minClearance: 0,
        })
        continue
      }

      if (gap + 1e-9 >= minClearance) continue
      violations.push({
        type: "via_overlaps_unrelated_pad",
        connectionName: via.connectionName,
        pcbTraceId: via.pcbTraceId,
        via: {
          x: via.x,
          y: via.y,
          diameter: via.diameter,
          layers: via.layers,
        },
        pad: {
          center: pad.center,
          width: pad.width,
          height: pad.height,
          layers: pad.layers,
          connectedTo: pad.connectedTo,
        },
        gap,
        minClearance,
      })
    }
  }

  return violations
}

export function getSimpleRouteJsonOutputValidationFailure(
  srj: SimpleRouteJson,
  opts: ValidateSimpleRouteJsonOutputOptions = {},
): string | null {
  const violations = validateSimpleRouteJsonOutput(srj, opts)
  if (violations.length === 0) return null
  const first = violations[0]!
  const extra =
    violations.length > 1 ? ` (${violations.length} violations)` : ""
  return (
    `${first.type} on ${first.connectionName} via=(${first.via.x.toFixed(3)}, ${first.via.y.toFixed(3)}) ` +
    `gap=${first.gap.toFixed(3)} min=${first.minClearance.toFixed(3)}${extra}`
  )
}
