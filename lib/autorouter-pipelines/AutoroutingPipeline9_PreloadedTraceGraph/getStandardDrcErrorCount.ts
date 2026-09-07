type ReferenceError = {
  type?: unknown
  pcb_placement_error_id?: unknown
  pcb_pad_pad_clearance_error_id?: unknown
}

/** Recognizes only the two supplemental checker identities in getDrcErrors. */
export const isSupplementaryViaPadError = (
  error: ReferenceError,
): boolean => {
  return (
    (error.type === "pcb_placement_error" &&
      typeof error.pcb_placement_error_id === "string" &&
      error.pcb_placement_error_id.startsWith("via_in_pad_")) ||
    (error.type === "pcb_pad_pad_clearance_error" &&
      typeof error.pcb_pad_pad_clearance_error_id === "string" &&
      error.pcb_pad_pad_clearance_error_id.startsWith("via_pad_clearance_"))
  )
}

/** Count unfamiliar errors conservatively; retain the expanded list unchanged. */
export const getStandardDrcErrorCount = (
  errors: readonly ReferenceError[],
): number => {
  let count = 0
  for (const error of errors) {
    if (!isSupplementaryViaPadError(error)) count++
  }
  return count
}
