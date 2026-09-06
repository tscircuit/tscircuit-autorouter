import type { AnyCircuitElement } from "circuit-json"

export const areDelimiterPrefixesUnique = (
  identifiers: ReadonlySet<string>,
): boolean => {
  for (const identifier of identifiers) {
    let separatorIndex = identifier.indexOf("_")
    while (separatorIndex !== -1) {
      if (identifiers.has(identifier.slice(0, separatorIndex))) return false
      separatorIndex = identifier.indexOf("_", separatorIndex + 1)
    }
  }
  return true
}

/** Proves official underscore-delimited copper pair keys cannot alias. */
export const areDrcCopperPairIdentifiersUnambiguous = (
  circuitJson: readonly AnyCircuitElement[],
): boolean => {
  const copperIds = new Set<string>()
  const traceIds = new Set<string>()
  const padIds = new Set<string>()
  const viaIds = new Set<string>()
  for (const element of circuitJson) {
    let identifier: string
    if (element.type === "pcb_trace") {
      identifier = element.pcb_trace_id
      traceIds.add(identifier)
    } else if (element.type === "pcb_via") {
      identifier = element.pcb_via_id
      viaIds.add(identifier)
    } else if (element.type === "pcb_smtpad") {
      identifier = element.pcb_smtpad_id
      padIds.add(identifier)
    } else if (element.type === "pcb_plated_hole") {
      identifier = element.pcb_plated_hole_id
      padIds.add(identifier)
    } else if (element.type === "pcb_hole") {
      identifier = element.pcb_hole_id
    } else if (element.type === "pcb_keepout") {
      identifier = element.pcb_keepout_id
    } else {
      continue
    }
    if (
      typeof identifier !== "string" ||
      !identifier ||
      copperIds.has(identifier)
    ) {
      return false
    }
    copperIds.add(identifier)
  }
  // Generic overlap keys begin with a trace id, including reversed wire pairs.
  // Typed pad/trace keys begin with a pad id; typed via/trace and both via
  // spacing keys begin with a via id. A unique delimiter prefix plus globally
  // unique physical copper ids makes each such key identify only one pair.
  return (
    areDelimiterPrefixesUnique(traceIds) &&
    areDelimiterPrefixesUnique(padIds) &&
    areDelimiterPrefixesUnique(viaIds)
  )
}
