import type { AnyCircuitElement } from "circuit-json"

type DrcError = Record<string, unknown>

type JointDrcSnapshot = {
  errors: readonly DrcError[]
  circuitJson: readonly AnyCircuitElement[]
}

type CopperParticipant = {
  kind: "trace" | "via" | "obstacle"
  identity: string
}

type CopperElementsById = Map<string, Record<string, unknown>[]>

const stringifyDrcRecord = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stringifyDrcRecord).join(",")}]`
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) => `${JSON.stringify(key)}:${stringifyDrcRecord(entry)}`,
      )
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "undefined"
}

const getCopperElementsById = (
  circuitJson: readonly AnyCircuitElement[],
): CopperElementsById => {
  const elementsById: CopperElementsById = new Map()
  for (const circuitElement of circuitJson) {
    const element = circuitElement as unknown as Record<string, unknown>
    const type = element.type
    if (
      type !== "pcb_trace" &&
      type !== "pcb_via" &&
      type !== "pcb_smtpad" &&
      type !== "pcb_plated_hole" &&
      type !== "pcb_hole" &&
      type !== "pcb_keepout"
    ) {
      continue
    }
    const id = element[`${type}_id`]
    if (typeof id !== "string" || id.length === 0) continue
    const elements = elementsById.get(id) ?? []
    elements.push(element)
    elementsById.set(id, elements)
  }
  return elementsById
}

const resolveCopperParticipant = (
  elementsById: CopperElementsById,
  id: string,
  expectedKind: CopperParticipant["kind"] | undefined,
): CopperParticipant => {
  const elements = (elementsById.get(id) ?? []).filter((element) => {
    const kind =
      element.type === "pcb_trace"
        ? "trace"
        : element.type === "pcb_via"
          ? "via"
          : "obstacle"
    return expectedKind === undefined || kind === expectedKind
  })
  if (elements.length !== 1) {
    throw new Error(
      `Pipeline9 joint DRC cannot resolve copper participant "${id}"`,
    )
  }
  const element = elements[0]!
  if (element.type !== "pcb_via") {
    return {
      kind: element.type === "pcb_trace" ? "trace" : "obstacle",
      identity: JSON.stringify([element.type, id]),
    }
  }
  if (
    typeof element.pcb_trace_id !== "string" ||
    typeof element.x !== "number" ||
    !Number.isFinite(element.x) ||
    typeof element.y !== "number" ||
    !Number.isFinite(element.y) ||
    !Array.isArray(element.layers) ||
    element.layers.length === 0 ||
    !element.layers.every((layer) => typeof layer === "string")
  ) {
    throw new Error(
      "Pipeline9 joint DRC output requires a via owner and physical site",
    )
  }
  // Serialized via numbers change when unrelated routes insert or remove
  // vias. A residual violation must retain its physical site, not merely
  // its owner's name. Without via lineage, moved residual sites are rejected;
  // a moved via with no remaining violation needs no identity match.
  return {
    kind: "via",
    identity: JSON.stringify([
      element.type,
      element.pcb_trace_id,
      element.x,
      element.y,
      [...element.layers].sort(),
    ]),
  }
}

const getCopperErrorPair = (
  error: DrcError,
  elementsById: CopperElementsById,
): string | undefined => {
  const errorType = error.type ?? error.error_type
  const traceId =
    typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
  let participantIds: string[]
  let expectedKinds: CopperParticipant["kind"][]
  let relation = "copper-gap"
  if (errorType === "pcb_pad_trace_clearance_error") {
    if (!traceId || typeof error.pcb_pad_id !== "string") {
      throw new Error("Pipeline9 joint pad DRC requires both copper identities")
    }
    participantIds = [traceId, error.pcb_pad_id]
    expectedKinds = ["trace", "obstacle"]
  } else if (errorType === "pcb_via_trace_clearance_error") {
    if (!traceId || typeof error.pcb_via_id !== "string") {
      throw new Error("Pipeline9 joint via DRC requires both copper identities")
    }
    participantIds = [traceId, error.pcb_via_id]
    expectedKinds = ["trace", "via"]
  } else if (errorType === "pcb_via_clearance_error") {
    if (
      !Array.isArray(error.pcb_via_ids) ||
      error.pcb_via_ids.length !== 2 ||
      !error.pcb_via_ids.every((id) => typeof id === "string")
    ) {
      throw new Error(
        "Pipeline9 joint via-spacing DRC requires two via identities",
      )
    }
    participantIds = error.pcb_via_ids as string[]
    expectedKinds = ["via", "via"]
    const errorId = error.pcb_error_id
    if (
      typeof errorId !== "string" ||
      (!errorId.startsWith("same_net_vias_close_") &&
        !errorId.startsWith("different_net_vias_close_"))
    ) {
      throw new Error(
        "Pipeline9 joint via-spacing DRC requires its net relation",
      )
    }
    relation = errorId.startsWith("same_net_")
      ? "same-net-via-gap"
      : "different-net-via-gap"
  } else if (
    errorType === "pcb_trace_error" &&
    typeof error.pcb_trace_error_id === "string" &&
    error.pcb_trace_error_id.startsWith("overlap_")
  ) {
    const prefix = `overlap_${traceId}_`
    if (!traceId || !error.pcb_trace_error_id.startsWith(prefix)) {
      throw new Error("Pipeline9 joint overlap DRC requires its primary trace")
    }
    const otherId = error.pcb_trace_error_id.slice(prefix.length)
    participantIds = [traceId, otherId]
    expectedKinds = ["trace"]
    if (
      error.pcb_via_id === otherId ||
      (Array.isArray(error.pcb_via_ids) && error.pcb_via_ids.includes(otherId))
    ) {
      expectedKinds.push("via")
    } else if (
      Array.isArray(error.pcb_trace_ids) &&
      error.pcb_trace_ids.includes(otherId)
    ) {
      expectedKinds.push("trace")
    }
  } else {
    return undefined
  }
  const identities = participantIds.map((id, index) => {
    return resolveCopperParticipant(elementsById, id, expectedKinds[index])
      .identity
  })
  return JSON.stringify([relation, ...identities.sort()])
}

const getErrorGroups = (snapshot: JointDrcSnapshot): Map<string, number[]> => {
  const elementsById = getCopperElementsById(snapshot.circuitJson)
  const groups = new Map<string, number[]>()
  for (const error of snapshot.errors) {
    const pair = getCopperErrorPair(error, elementsById)
    let gap: number | undefined
    if (pair && error.actual_clearance !== undefined) {
      if (
        typeof error.actual_clearance !== "number" ||
        !Number.isFinite(error.actual_clearance) ||
        typeof error.minimum_clearance !== "number" ||
        !Number.isFinite(error.minimum_clearance)
      ) {
        throw new Error(
          "Pipeline9 joint DRC requires finite clearance measurements",
        )
      }
      gap = error.actual_clearance
    } else if (pair && typeof error.message === "string") {
      const match = error.message.match(/gap: (-?\d+(?:\.\d+)?)mm/)
      if (match) gap = Number.parseFloat(match[1]!)
    }
    // Generic too-close errors expose only the official checker's rounded
    // message measurement. Contacts have no measured gap, so require their
    // exact record to remain unchanged or disappear. Do not manufacture a
    // score for connectivity, board-edge, or unknown findings either.
    const key =
      pair !== undefined && gap !== undefined
        ? pair
        : `exact:${stringifyDrcRecord(error)}`
    const severities = groups.get(key) ?? []
    severities.push(gap === undefined ? 0 : -gap)
    groups.set(key, severities)
  }
  for (const severities of groups.values()) {
    severities.sort((left, right) => right - left)
  }
  return groups
}

/** Checks unfiltered output without exchanging or worsening DRCs. */
export const isPipeline9JointDrcOutputNoWorse = ({
  candidate,
  current,
}: {
  candidate: JointDrcSnapshot
  current: JointDrcSnapshot
}): boolean => {
  if (candidate.errors.length > current.errors.length) return false
  // A fully reference-clean output has no retained participants to match.
  if (candidate.errors.length === 0) return true
  const currentGroups = getErrorGroups(current)
  const candidateGroups = getErrorGroups(candidate)
  for (const [pair, candidateSeverities] of candidateGroups) {
    const currentSeverities = currentGroups.get(pair)
    if (
      !currentSeverities ||
      candidateSeverities.length > currentSeverities.length ||
      candidateSeverities.some(
        (severity, index) => severity > currentSeverities[index]!,
      )
    ) {
      return false
    }
  }
  return true
}
