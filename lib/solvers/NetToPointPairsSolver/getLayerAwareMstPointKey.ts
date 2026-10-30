import type { ConnectionPoint, PointKey } from "lib/types"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"

/** A same-net physical point-contact identity, never an inferred net/port alias. */
export function getLayerAwareMstPointKey(point: ConnectionPoint): PointKey {
  const layers = [...new Set(getConnectionPointLayers(point))].sort()
  if (![point.x, point.y].every(Number.isFinite) || layers.length === 0 || layers.some((layer) => typeof layer !== "string" || layer.length === 0)) {
    throw new Error("Layer-aware MST identity requires finite XY and explicit layer availability")
  }
  return JSON.stringify([point.x, point.y, layers])
}
