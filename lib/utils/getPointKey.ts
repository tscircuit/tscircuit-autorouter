import { ConnectionPoint, PointKey } from "lib/types"
import { getConnectionPointLayers } from "./connection-point-utils"

/**
 * Generates a unique string key for a ConnectionPoint,
 * prioritizing pointId if available, otherwise using coordinates and layer(s).
 */
export function getPointKey(connectionPoint: ConnectionPoint): PointKey {
  if (connectionPoint.pointId) {
    return connectionPoint.pointId
  }

  const layerKey = [...getConnectionPointLayers(connectionPoint)]
    .sort()
    .join("-")

  // Using toFixed(4) for precision in coordinate-based keys
  return `${connectionPoint.x.toFixed(4)},${connectionPoint.y.toFixed(4)},${layerKey}`
}
