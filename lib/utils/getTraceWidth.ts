import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"

export const isFinitePositiveTraceWidth = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0

export const getTraceWidthFromMultiplier = (
  minTraceWidth: number,
  traceWidthMultiplier: unknown,
): number | undefined => {
  if (
    !isFinitePositiveTraceWidth(minTraceWidth) ||
    !isFinitePositiveTraceWidth(traceWidthMultiplier)
  ) {
    return undefined
  }

  return minTraceWidth * traceWidthMultiplier
}

export const getOptionalDefaultTraceWidth = ({
  minTraceWidth,
  nominalTraceWidth,
  traceWidthMultiplier,
}: {
  minTraceWidth: number
  nominalTraceWidth?: unknown
  traceWidthMultiplier?: unknown
}): number | undefined => {
  if (isFinitePositiveTraceWidth(nominalTraceWidth)) {
    return nominalTraceWidth
  }

  return getTraceWidthFromMultiplier(minTraceWidth, traceWidthMultiplier)
}

export const getDefaultTraceWidthForSimpleRouteJson = (
  srj: Pick<
    SimpleRouteJson,
    "minTraceWidth" | "nominalTraceWidth" | "traceWidthMultiplier"
  >,
): number =>
  getOptionalDefaultTraceWidth({
    minTraceWidth: srj.minTraceWidth,
    nominalTraceWidth: srj.nominalTraceWidth,
    traceWidthMultiplier: srj.traceWidthMultiplier,
  }) ?? srj.minTraceWidth

export const getConnectionRequestedTraceWidth = (
  connection: Pick<
    SimpleRouteConnection,
    "nominalTraceWidth" | "traceWidthMultiplier"
  >,
  { minTraceWidth }: { minTraceWidth: number },
): number | undefined => {
  if (isFinitePositiveTraceWidth(connection.nominalTraceWidth)) {
    return connection.nominalTraceWidth
  }

  return getTraceWidthFromMultiplier(
    minTraceWidth,
    connection.traceWidthMultiplier,
  )
}
