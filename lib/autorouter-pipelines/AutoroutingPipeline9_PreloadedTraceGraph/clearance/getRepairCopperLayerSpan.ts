// Derived from tscircuit/repair04@4273e9455084b7b35ebc860ebe4483b9d19692ea (MIT).
import type { SimpleRouteJson } from "high-density-repair03/lib"

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
