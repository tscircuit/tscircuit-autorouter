import type { SimpleRouteJson } from "./nativeRepairTypes"

/** Trace layers are electrical; a default drilled via occupies the whole board. */
export function getRepairCopperLayerSpan(
  srj: Pick<SimpleRouteJson, "layerCount"> & {
    allowBlindAndBuriedVias?: boolean
  },
  a: { z: number },
  b: { z: number },
): { minZ: number; maxZ: number } {
  const throughHole = a.z !== b.z && srj.allowBlindAndBuriedVias !== true
  return {
    minZ: throughHole ? 0 : Math.min(a.z, b.z),
    maxZ: throughHole ? srj.layerCount - 1 : Math.max(a.z, b.z),
  }
}
