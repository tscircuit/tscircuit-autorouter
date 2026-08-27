type SrjViaPolicy = {
  allowBlindAndBuriedVias?: boolean
}

export type RepairSrjWithViaPolicy<T extends SrjViaPolicy> = T & {
  allowBlindAndBuriedVias: boolean
}

/** Materializes the board's default via policy before crossing into repair03. */
export const normalizeRepairSrjViaPolicy = <T extends SrjViaPolicy>(
  srj: T,
): RepairSrjWithViaPolicy<T> => {
  const allowBlindAndBuriedVias = srj.allowBlindAndBuriedVias ?? false

  return {
    ...srj,
    allowBlindAndBuriedVias,
  }
}
