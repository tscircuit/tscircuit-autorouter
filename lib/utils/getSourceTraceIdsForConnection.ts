import type { SimpleRouteConnection, TraceId } from "lib/types"

type LegacySourceTraceConnection = SimpleRouteConnection & {
  source_trace_id?: TraceId
}

/**
 * Returns the source trace ids carried by a SimpleRouteConnection.
 *
 * @param connection - The connection whose source-trace provenance should be
 * read. Explicit `source_trace_ids` is preferred. Legacy `source_trace_id` is
 * accepted only at the boundary and normalized into `source_trace_ids`.
 * @returns A deduplicated, insertion-ordered list of source trace ids. Returns
 * an empty list when the connection is net-only or no source-trace identity can
 * be recovered.
 *
 * @note This function preserves provenance; it does not decide which single
 * source trace owns a routed segment. Callers that need one final id should use
 * route geometry or endpoint ports to choose from the returned candidates.
 * @caution Do not parse ids from connection names. Single unmerged connection
 * names are intentionally ignored unless they also appear in explicit source id
 * fields.
 */
export function getSourceTraceIdsForConnection({
  connection,
}: {
  connection: LegacySourceTraceConnection
}): TraceId[] {
  const source_trace_ids = new Set<TraceId>()

  for (const source_trace_id of connection.source_trace_ids ?? []) {
    source_trace_ids.add(source_trace_id)
  }

  if (connection.source_trace_id) {
    // Normalize old core/SRJ input at the boundary. Past this point the
    // autorouter should carry provenance with source_trace_ids only.
    source_trace_ids.add(connection.source_trace_id)
  }

  if (source_trace_ids.size > 0) {
    return Array.from(source_trace_ids)
  }

  for (const mergedConnectionName of connection.mergedConnectionNames ?? []) {
    source_trace_ids.add(mergedConnectionName)
  }

  return Array.from(source_trace_ids)
}

/**
 * Returns a SimpleRouteConnection with normalized source-trace provenance.
 *
 * @param connection - Connection that may contain old singular
 * `source_trace_id` input from core or an existing normalized
 * `source_trace_ids` list.
 * @returns A shallow copy that carries only `source_trace_ids` for provenance.
 * The legacy singular input field is intentionally removed.
 *
 * @caution Use this at merge/split boundaries so downstream autorouter stages
 * do not have to handle two provenance properties.
 */
export function normalizeConnectionSourceTraceIds({
  connection,
}: {
  connection: LegacySourceTraceConnection
}): SimpleRouteConnection {
  const { source_trace_id: _source_trace_id, ...normalizedConnection } =
    connection
  const source_trace_ids = getSourceTraceIdsForConnection({ connection })

  return {
    ...normalizedConnection,
    source_trace_ids:
      source_trace_ids.length > 0 ? source_trace_ids : undefined,
  }
}
