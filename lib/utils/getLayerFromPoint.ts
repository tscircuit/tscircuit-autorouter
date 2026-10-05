import type { ConnectionPoint } from "lib/types"
import { getConnectionPointLayer } from "./connection-point-utils"

/** Returns the primary routing layer of a connection point, if present. */
export function getLayerFromPoint({
  point,
}: {
  point: ConnectionPoint | null | undefined
}): string | undefined {
  if (!point) return undefined
  return getConnectionPointLayer(point)
}
