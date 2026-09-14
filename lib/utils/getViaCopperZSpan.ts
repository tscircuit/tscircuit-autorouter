import type { SimpleRouteJson } from "lib/types"

export type ViaLayerPolicy = Pick<
  SimpleRouteJson,
  "layerCount" | "allowBlindAndBuriedVias"
>

/**
 * Through vias occupy the whole board stack, even when routing ends on an
 * inner layer.
 */
export const getViaCopperZSpan = ({
  fromZ,
  toZ,
  layerCount,
  allowBlindAndBuriedVias,
}: ViaLayerPolicy & {
  fromZ: number
  toZ: number
}): { minZ: number; maxZ: number } => {
  return allowBlindAndBuriedVias
    ? { minZ: Math.min(fromZ, toZ), maxZ: Math.max(fromZ, toZ) }
    : { minZ: 0, maxZ: layerCount - 1 }
}
