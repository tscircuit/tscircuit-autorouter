import type { EvaluateRelaxedDrcResult } from "lib/testing/evaluate-relaxed-drc"

/** Stable physical identities, even when shared vias renumber converter IDs. */
export const getDrcErrorSignatures = (
  result: EvaluateRelaxedDrcResult,
  mergedSites: ReadonlyMap<string, string>,
): Map<string, number> => {
  const vias = new Map(
    result.circuitJson
      .filter((element) => element.type === "pcb_via")
      .map((via) => {
        const site = `${via.x},${via.y}`
        return [via.pcb_via_id, mergedSites.get(site) ?? site] as const
      }),
  )
  const getViaSite = (id: string): string => {
    const site = vias.get(id)
    if (site === undefined) {
      throw new Error(`Local DRC comparison cannot find via ${id}`)
    }
    return site
  }
  const signatures = new Map<string, number>()
  for (const error of result.errors) {
    let identity: unknown[]
    // Trace-overlap errors have no exact gap field. The geometry guard requires
    // every moved segment to be clear; existing overlaps must remain untouched.
    let gap = Infinity
    if (error.type !== "pcb_trace_error") {
      if (
        typeof error.actual_clearance !== "number" ||
        !Number.isFinite(error.actual_clearance)
      ) {
        throw new Error("Local DRC comparison requires a measured clearance")
      }
      gap = error.actual_clearance
    }
    if (error.type === "pcb_via_trace_clearance_error") {
      identity = [error.type, error.pcb_trace_id, getViaSite(error.pcb_via_id)]
    } else if (error.type === "pcb_pad_trace_clearance_error") {
      identity = [error.type, error.pcb_trace_id, error.pcb_pad_id]
    } else if (error.type === "pcb_via_clearance_error") {
      identity = [
        error.type,
        error.pcb_via_ids.map(getViaSite).sort(),
      ]
    } else {
      const prefix = `overlap_${error.pcb_trace_id}_`
      const other = error.pcb_trace_error_id.startsWith(prefix)
        ? error.pcb_trace_error_id.slice(prefix.length)
        : undefined
      identity = other
        ? [error.type, error.pcb_trace_id, vias.get(other) ?? other]
        : [error.type, error.pcb_trace_error_id]
    }
    const key = JSON.stringify(identity)
    signatures.set(key, Math.min(signatures.get(key) ?? Infinity, gap))
  }
  return signatures
}
