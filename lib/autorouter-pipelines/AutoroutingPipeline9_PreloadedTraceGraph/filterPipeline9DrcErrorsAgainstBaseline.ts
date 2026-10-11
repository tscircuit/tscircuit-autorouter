type DrcError = Record<string, unknown>

type PreparedTraceAliases = ReadonlyArray<readonly [string, string]>

const DRC_ERROR_ID_KEYS = [
  "pcb_trace_error_id",
  "pcb_error_id",
  "pcb_via_trace_clearance_error_id",
  "pcb_pad_trace_clearance_error_id",
] as const

const isMissingConnectionError = (error: DrcError): boolean =>
  typeof error.pcb_trace_error_id === "string" &&
  error.pcb_trace_error_id.startsWith("missing_connection_")

const normalizePreparedTraceIds = (
  value: string,
  preparedTraceAliases: PreparedTraceAliases,
): string => {
  let normalized = value
  for (const [preparedTraceId, originalTraceId] of preparedTraceAliases) {
    normalized = normalized.replaceAll(preparedTraceId, originalTraceId)
  }
  return normalized
}

const getViaClearanceErrorIdentity = (
  error: DrcError,
  preparedTraceAliases: PreparedTraceAliases,
): string | undefined => {
  const traceIds = [
    ...(typeof error.pcb_trace_id === "string" ? [error.pcb_trace_id] : []),
    ...(Array.isArray(error.pcb_trace_ids)
      ? error.pcb_trace_ids.filter(
          (traceId): traceId is string => typeof traceId === "string",
        )
      : []),
  ]
    .map((traceId) => normalizePreparedTraceIds(traceId, preparedTraceAliases))
    .filter(
      (traceId, traceIndex, allTraceIds) =>
        allTraceIds.indexOf(traceId) === traceIndex,
    )
    .sort()
  const centerCandidate =
    error.center && typeof error.center === "object"
      ? (error.center as Record<string, unknown>)
      : error.pcb_center && typeof error.pcb_center === "object"
        ? (error.pcb_center as Record<string, unknown>)
        : undefined
  const center =
    typeof centerCandidate?.x === "number" &&
    typeof centerCandidate.y === "number"
      ? { x: centerCandidate.x, y: centerCandidate.y }
      : undefined
  const netRelation =
    typeof error.pcb_via_pair_net_relation === "string"
      ? error.pcb_via_pair_net_relation
      : undefined

  // Sequential via IDs depend on trace iteration order, so they cannot prove
  // that a candidate violation was inherited. Missing stable metadata is kept
  // repairable instead of risking a false baseline match.
  if (traceIds.length === 0 || !center || !netRelation) return undefined
  return `pcb_via_clearance_error:${JSON.stringify({ traceIds, center, netRelation })}`
}

const getDrcErrorIdentity = (
  error: DrcError,
  preparedTraceAliases: PreparedTraceAliases,
): string | undefined => {
  const errorType = String(error.type ?? error.error_type ?? "unknown")
  if (errorType === "pcb_via_clearance_error") {
    return getViaClearanceErrorIdentity(error, preparedTraceAliases)
  }
  for (const idKey of DRC_ERROR_ID_KEYS) {
    const errorId = error[idKey]
    if (typeof errorId === "string") {
      return `${errorType}:${normalizePreparedTraceIds(errorId, preparedTraceAliases)}`
    }
  }

  const identityFields = Object.fromEntries(
    Object.entries(error)
      .filter(
        ([key, value]) =>
          (key.endsWith("_id") || key.endsWith("_ids")) &&
          (typeof value === "string" || Array.isArray(value)),
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        typeof value === "string"
          ? normalizePreparedTraceIds(value, preparedTraceAliases)
          : value,
      ]),
  )
  return `${errorType}:${JSON.stringify(identityFields)}`
}

/** Prepares inherited identities once for all candidates in a repair search. */
export const createPipeline9DrcErrorsAgainstBaselineFilter = (
  baselineErrors: DrcError[],
): (<TError extends DrcError>(options: {
  errors: TError[]
  originalTraceIdByPreparedTraceId?: ReadonlyMap<string, string>
}) => TError[]) => {
  const baselineErrorIdentities = new Set(
    baselineErrors
      // A missing connection describes unfinished routing, not an inherited
      // geometric violation. Pipeline9 must continue to repair it even when
      // the same finding exists before the candidate routes are added.
      .filter((error) => !isMissingConnectionError(error))
      .map((error) => getDrcErrorIdentity(error, [])),
  )
  baselineErrorIdentities.delete(undefined)

  return <TError extends DrcError>({
    errors,
    originalTraceIdByPreparedTraceId = new Map(),
  }: {
    errors: TError[]
    originalTraceIdByPreparedTraceId?: ReadonlyMap<string, string>
  }): TError[] => {
    // Longest aliases must be replaced first when section ids share prefixes.
    // This order is constant across every identity field in the candidate.
    const preparedTraceAliases = [...originalTraceIdByPreparedTraceId].sort(
      ([left], [right]) => right.length - left.length,
    )
    return errors.filter((error) => {
      const identity = getDrcErrorIdentity(error, preparedTraceAliases)
      return identity === undefined || !baselineErrorIdentities.has(identity)
    })
  }
}

/** Removes DRC violations already present in the supplied prerouted board. */
export const filterPipeline9DrcErrorsAgainstBaseline = <
  TError extends DrcError,
>({
  errors,
  baselineErrors,
  originalTraceIdByPreparedTraceId,
}: {
  errors: TError[]
  baselineErrors: DrcError[]
  originalTraceIdByPreparedTraceId?: ReadonlyMap<string, string>
}): TError[] =>
  createPipeline9DrcErrorsAgainstBaselineFilter(baselineErrors)({
    errors,
    originalTraceIdByPreparedTraceId,
  })
