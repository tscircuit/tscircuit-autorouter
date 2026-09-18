import type { TinyHyperGraphTopology } from "tiny-hypergraph/lib/index"

/** Restore graph permissions by stable identity, independent of optimizer ordering. */
export function getPortSectionMaskForTopology(
  source: TinyHyperGraphTopology,
  sourceMask: Int8Array,
  target: TinyHyperGraphTopology,
): Int8Array {
  if (sourceMask.length !== source.portCount) {
    throw new Error("Original port mask does not match its topology")
  }
  const permissions = new Map<string, number>()
  for (let portId = 0; portId < source.portCount; portId++) {
    const identity: unknown = source.portMetadata?.[portId]?.serializedPortId
    const permission = sourceMask[portId]
    if (
      typeof identity !== "string" ||
      identity.length === 0 ||
      permissions.has(identity)
    ) {
      throw new Error(
        `Missing or duplicate original port identity at ${portId}`,
      )
    }
    if (permission !== 0 && permission !== 1) {
      throw new Error(`Invalid original port permission at ${portId}`)
    }
    permissions.set(identity, permission)
  }
  const mask = new Int8Array(target.portCount)
  const seen = new Set<string>()
  for (let portId = 0; portId < target.portCount; portId++) {
    const identity: unknown = target.portMetadata?.[portId]?.serializedPortId
    if (
      typeof identity !== "string" ||
      seen.has(identity) ||
      !permissions.has(identity)
    ) {
      throw new Error(
        `Missing, duplicate, or unknown target port identity at ${portId}`,
      )
    }
    seen.add(identity)
    mask[portId] = permissions.get(identity)!
  }
  return mask
}
