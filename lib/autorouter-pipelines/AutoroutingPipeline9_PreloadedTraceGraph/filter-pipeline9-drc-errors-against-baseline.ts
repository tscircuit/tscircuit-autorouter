type DrcError = Record<string, unknown>;

const DRC_ERROR_ID_KEYS = [
  "pcb_trace_error_id",
  "pcb_error_id",
  "pcb_via_trace_clearance_error_id",
  "pcb_pad_trace_clearance_error_id",
] as const;

const isMissingConnectionError = (error: DrcError): boolean =>
  typeof error.pcb_trace_error_id === "string" &&
  error.pcb_trace_error_id.startsWith("missing_connection_");

const normalizePreparedTraceIds = (
  value: string,
  originalTraceIdByPreparedTraceId: ReadonlyMap<string, string>,
): string => {
  let normalized = value;
  const aliases = [...originalTraceIdByPreparedTraceId].sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [preparedTraceId, originalTraceId] of aliases) {
    normalized = normalized.replaceAll(preparedTraceId, originalTraceId);
  }
  return normalized;
};

const getDrcErrorIdentity = (
  error: DrcError,
  originalTraceIdByPreparedTraceId: ReadonlyMap<string, string>,
): string => {
  const errorType = String(error.type ?? error.error_type ?? "unknown");
  for (const idKey of DRC_ERROR_ID_KEYS) {
    const errorId = error[idKey];
    if (typeof errorId === "string") {
      return `${errorType}:${normalizePreparedTraceIds(errorId, originalTraceIdByPreparedTraceId)}`;
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
          ? normalizePreparedTraceIds(value, originalTraceIdByPreparedTraceId)
          : value,
      ]),
  );
  return `${errorType}:${JSON.stringify(identityFields)}`;
};

/** Removes DRC violations already present in the supplied prerouted board. */
export const filterPipeline9DrcErrorsAgainstBaseline = <
  TError extends DrcError,
>({
  errors,
  baselineErrors,
  originalTraceIdByPreparedTraceId = new Map(),
}: {
  errors: TError[];
  baselineErrors: DrcError[];
  originalTraceIdByPreparedTraceId?: ReadonlyMap<string, string>;
}): TError[] => {
  const baselineErrorIdentities = new Set(
    baselineErrors
      // A missing connection describes unfinished routing, not an inherited
      // geometric violation. Pipeline9 must continue to repair it even when
      // the same finding exists before the candidate routes are added.
      .filter((error) => !isMissingConnectionError(error))
      .map((error) => getDrcErrorIdentity(error, new Map())),
  );
  return errors.filter(
    (error) =>
      !baselineErrorIdentities.has(
        getDrcErrorIdentity(error, originalTraceIdByPreparedTraceId),
      ),
  );
};
