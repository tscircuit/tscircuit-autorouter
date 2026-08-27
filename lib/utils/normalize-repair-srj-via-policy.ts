type SrjViaPolicy = {
  allowBlindAndBuriedVias?: boolean
  obstacles?: readonly unknown[]
}

/**
 * Materializes the documented through-via default for the current role-aware
 * SRJ contract while preserving historical behavior for role-less fixtures.
 */
export const normalizeRepairSrjViaPolicy = <T extends SrjViaPolicy>(
  srj: T,
): T => {
  if (
    srj.allowBlindAndBuriedVias !== undefined ||
    !srj.obstacles?.some(
      (obstacle) =>
        typeof obstacle === "object" &&
        obstacle !== null &&
        "obstacleRole" in obstacle &&
        obstacle.obstacleRole !== undefined,
    )
  ) {
    return srj
  }

  return {
    ...srj,
    allowBlindAndBuriedVias: false,
  }
}
