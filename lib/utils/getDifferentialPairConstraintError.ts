import type { SimpleRouteJson } from "lib/types"

/** Reject malformed external pair constraints before constructing route graphs. */
export function getDifferentialPairConstraintError(
  srj: SimpleRouteJson,
): string | null {
  if (srj.differentialPairs === undefined) return null
  if (!Array.isArray(srj.differentialPairs))
    return "Differential pair declarations must be an array"

  for (const [pairIndex, pair] of srj.differentialPairs.entries()) {
    if (
      !pair ||
      typeof pair !== "object" ||
      !Array.isArray(pair.connectionNames) ||
      pair.connectionNames.length !== 2 ||
      pair.connectionNames[0] === pair.connectionNames[1] ||
      !pair.connectionNames.every(
        (connectionName) =>
          typeof connectionName === "string" && connectionName.length > 0,
      )
    )
      return `Differential pair ${pairIndex + 1} must name two distinct, non-empty connections`

    const pairName = pair.connectionNames.join("/")
    if (!Number.isFinite(pair.lengthTolerance) || pair.lengthTolerance < 0)
      return `Differential pair "${pairName}" lengthTolerance must be a non-negative finite number`
    if (
      pair.traceGap !== undefined &&
      (!Number.isFinite(pair.traceGap) || pair.traceGap < 0)
    )
      return `Differential pair "${pairName}" traceGap must be a non-negative finite number`
    if (
      pair.maxUncoupledLength !== undefined &&
      (!Number.isFinite(pair.maxUncoupledLength) || pair.maxUncoupledLength < 0)
    )
      return `Differential pair "${pairName}" maxUncoupledLength must be a non-negative finite number`
  }
  return null
}
