import type { TinyHyperGraphTopology } from "tiny-hypergraph/lib/index"
import type { TinyGraphFixedCopperClearanceContext } from "./createTinyGraphFixedCopperClearanceContext"

/** Native reservation meanings: -1 unrestricted, -2 blocked, otherwise one net. */
export function getTinyGraphFixedCopperPortReservations(params: {
  readonly topology: TinyHyperGraphTopology
  readonly context: TinyGraphFixedCopperClearanceContext
}): Int32Array {
  const { topology, context } = params
  const reservations = new Int32Array(topology.portCount).fill(-1)
  for (let portId = 0; portId < topology.portCount; portId++) {
    const allowedNetIds = context.clearanceIndex.getAllowedNetIdsAtPoint({
      point: {
        x: topology.portX[portId]!,
        y: topology.portY[portId]!,
        z: topology.portZ[portId]!,
      },
      copperDiameter: context.traceWidth,
    })
    if (allowedNetIds === null) continue
    const allowedNativeNetIds = new Set<number>()
    for (const canonicalNetId of allowedNetIds) {
      const netId = context.netIdByCanonicalNetId.get(canonicalNetId)
      if (netId !== undefined) allowedNativeNetIds.add(netId)
    }
    if (allowedNativeNetIds.size === 0) {
      reservations[portId] = -2
    } else if (allowedNativeNetIds.size === 1) {
      reservations[portId] = allowedNativeNetIds.values().next().value!
    } else if (
      allowedNativeNetIds.size !== context.canonicalNetIdByNetId.size
    ) {
      throw new Error(
        `TinyGraph fixed copper cannot represent the allowed net set at port ${portId} as one native reservation`,
      )
    }
  }
  return reservations
}
