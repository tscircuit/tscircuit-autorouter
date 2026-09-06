import {
  getPipeline9DrcErrorTraceIds,
  getPipeline9DrcScore,
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
  SCORE_EPSILON,
} from "./pipeline9JointDrcRepairUtils"

const getCopperConflictPairErrors = (
  errors: Pipeline9DrcError[],
): Map<string, Pipeline9DrcError[]> => {
  const pairs = new Map<string, Pipeline9DrcError[]>()
  for (const error of errors) {
    const viaOwnerIds = Array.isArray(error.__via_owner_trace_ids)
      ? error.__via_owner_trace_ids.filter(
          (identity): identity is string => typeof identity === "string",
        )
      : []
    const hasViaIdentity =
      typeof error.pcb_via_id === "string" ||
      (Array.isArray(error.pcb_via_ids) && error.pcb_via_ids.length > 0)
    if (hasViaIdentity && viaOwnerIds.length === 0) {
      throw new Error(
        "Pipeline9 high-density DRC acceptance requires normalized via owners",
      )
    }
    const padIds = new Set<string>()
    for (const field of [
      "pcb_pad_id",
      "pcb_smtpad_id",
      "pcb_plated_hole_id",
      "pcb_hole_id",
    ]) {
      const identity = error[field]
      if (typeof identity === "string") padIds.add(identity)
    }
    for (const field of [
      "__pad_ids",
      "pcb_pad_ids",
      "pcb_smtpad_ids",
      "pcb_plated_hole_ids",
    ]) {
      const identities = error[field]
      if (!Array.isArray(identities)) continue
      for (const identity of identities) {
        if (typeof identity === "string") padIds.add(identity)
      }
    }
    // Some pad-pair errors include a via id alongside the physical pad id.
    // Its stable identity is the owning trace, never the serialized via number.
    if (typeof error.pcb_via_id === "string") {
      padIds.delete(error.pcb_via_id)
    }
    if (Array.isArray(error.pcb_via_ids)) {
      for (const viaId of error.pcb_via_ids) {
        if (typeof viaId === "string") padIds.delete(viaId)
      }
    }
    const participants = new Set<string>([
      ...viaOwnerIds.map((identity) => `via:${identity}`),
      ...[...padIds].map((identity) => `pad:${identity}`),
    ])
    if (viaOwnerIds.length > 0) {
      // A via-to-trace conflict must not authorize a wire-to-wire conflict
      // between the same trace owners, or a reversal of their copper roles.
      if (typeof error.__trace_segment_owner_trace_id === "string") {
        participants.add(`trace:${error.__trace_segment_owner_trace_id}`)
      } else if (
        error.type === "pcb_trace_error" ||
        error.type === "pcb_via_trace_clearance_error"
      ) {
        throw new Error(
          "Pipeline9 high-density DRC acceptance requires the via-conflicting trace owner",
        )
      }
    } else {
      for (const traceId of getPipeline9DrcErrorTraceIds(error)) {
        if (!padIds.has(traceId)) participants.add(`trace:${traceId}`)
      }
    }
    const identities = [...participants].sort()
    if (identities.length === 0) {
      throw new Error(
        "Pipeline9 high-density DRC acceptance requires copper participant identities",
      )
    }
    const pairKeys: string[] = []
    if (identities.length === 1) {
      // Two vias on the same fragment have one normalized copper owner.
      pairKeys.push(JSON.stringify([identities[0], identities[0]]))
    } else {
      for (let left = 0; left < identities.length; left += 1) {
        for (let right = left + 1; right < identities.length; right += 1) {
          pairKeys.push(JSON.stringify([identities[left], identities[right]]))
        }
      }
    }
    for (const key of pairKeys) {
      const pairErrors = pairs.get(key) ?? []
      pairErrors.push(error)
      pairs.set(key, pairErrors)
    }
  }
  return pairs
}

/** Improves DRC without creating a copper pair or worsening an existing pair. */
export const isPipeline9HighDensityDrcCandidateBetter = (
  candidateErrors: Pipeline9DrcError[],
  currentErrors: Pipeline9DrcError[],
): boolean => {
  if (!isPipeline9DrcCandidateBetter(candidateErrors, currentErrors)) {
    return false
  }
  const currentPairs = getCopperConflictPairErrors(currentErrors)
  const candidatePairs = getCopperConflictPairErrors(candidateErrors)
  for (const [pair, candidatePairErrors] of candidatePairs) {
    const currentPairErrors = currentPairs.get(pair)
    if (!currentPairErrors) return false
    // A total count reduction must not compensate for a retained pair becoming
    // harder to repair. Keep Repair03-style severity steps within each pair,
    // using the same score and numerical tolerance as shared DRC acceptance.
    if (
      candidatePairErrors.length > currentPairErrors.length ||
      getPipeline9DrcScore(candidatePairErrors) >
        getPipeline9DrcScore(currentPairErrors) + SCORE_EPSILON
    ) {
      return false
    }
  }
  return true
}
