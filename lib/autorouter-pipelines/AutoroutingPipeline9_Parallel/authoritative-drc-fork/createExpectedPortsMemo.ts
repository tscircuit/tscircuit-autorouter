import type { PcbPort, SourceTrace } from "circuit-json"

export type ExpectedPortsMemo = {
  get: (source: SourceTrace) => PcbPort[]
  diagnostics: { sources: number; hits: number; nativeFilters: number; membershipEntries: number }
}

/** Per-call source identity cache; the caller proves that no observers can mutate it. */
export function createExpectedPortsMemo(pcbPorts: PcbPort[]): ExpectedPortsMemo {
  const values = new WeakMap<SourceTrace, PcbPort[]>()
  const diagnostics = { sources: 0, hits: 0, nativeFilters: 0, membershipEntries: 0 }
  const get = (sourceTrace: SourceTrace): PcbPort[] => {
    const existing = values.get(sourceTrace)
    if (existing !== undefined) {
      diagnostics.hits++
      return existing
    }
    const ids = sourceTrace.connected_source_port_ids
    if (ids !== undefined && ids !== null && !Array.isArray(ids)) {
      // Strings have substring-includes semantics; other malformed values may
      // throw. Preserve the original filter at every use for those inputs.
      diagnostics.nativeFilters++
      return pcbPorts.filter((port) => sourceTrace.connected_source_port_ids?.includes(port.source_port_id))
    }
    const membership = ids == null ? undefined : new Set(ids)
    const expected = membership === undefined
      ? pcbPorts.filter(() => false)
      : pcbPorts.filter((port) => membership.has(port.source_port_id))
    diagnostics.sources++
    diagnostics.membershipEntries += ids?.length ?? 0
    values.set(sourceTrace, expected)
    return expected
  }
  return { get, diagnostics }
}
