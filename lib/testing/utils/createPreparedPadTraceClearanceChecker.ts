import { checkPadTraceClearance } from "@tscircuit/checks"
import { getPrimaryId } from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { areDrcCopperPairIdentifiersUnambiguous } from "./areDrcCopperPairIdentifiersUnambiguous"

type PadTraceClearanceOptions = NonNullable<
  Parameters<typeof checkPadTraceClearance>[1]
>
type PadTraceClearanceErrors = ReturnType<typeof checkPadTraceClearance>

type CachedTraceErrors = {
  traceKey: string
  errors: PadTraceClearanceErrors
}

export type PreparedPadTraceClearanceCheckerStats = {
  evaluationCount: number
  nativeInvocationCount: number
  evaluatedTraceCount: number
  cacheHitTraceCount: number
}

export type PreparedPadTraceClearanceChecker = {
  (
    circuitJson: AnyCircuitElement[],
    options?: PadTraceClearanceOptions,
  ): PadTraceClearanceErrors
  getStats: () => Readonly<PreparedPadTraceClearanceCheckerStats>
}

const canOmitUnchangedTracesFromNameLookups = (
  circuitJson: AnyCircuitElement[],
  traces: PcbTrace[],
): boolean => {
  const traceIds = new Set(traces.map((trace): string => trace.pcb_trace_id))
  for (const element of circuitJson) {
    if (element.type === "pcb_trace") continue
    // An omitted trace must not shadow another element's primary identity,
    // including a port/component consulted while constructing a pair name.
    // Keep such coupled name lookups in the complete native computation.
    if (traceIds.has(getPrimaryId(element))) return false
  }
  return true
}

const serializePadTraceDependencies = (dependencies: unknown): string => {
  return JSON.stringify(
    dependencies,
    (_key: string, value: unknown): unknown => {
      // Geometry and native clearance arithmetic distinguish these values.
      // Tag strings as well so an opaque ID cannot alias a numeric tag.
      if (typeof value === "number") {
        return `number:${Object.is(value, -0) ? "-0" : String(value)}`
      }
      if (typeof value === "string") return `string:${value}`
      if (value === undefined) return "undefined:"
      if (value === null) return "null:"
      return value
    },
  )
}

const getPadTraceContextKey = (
  circuitJson: AnyCircuitElement[],
  options: PadTraceClearanceOptions,
): string => {
  const nameRelevantCircuitJson = circuitJson.map((element): unknown => {
    if (element.type !== "pcb_trace") return element
    // Native readable names inspect ordered endpoint references, including
    // interior references and first-primary-ID shadows. All non-trace
    // metadata, pad order, board defaults and trace metadata remain exact.
    const connectedPcbPortIds = element.route
      .flatMap(
        (point): Array<string | undefined> => [
          "start_pcb_port_id" in point ? point.start_pcb_port_id : undefined,
          "end_pcb_port_id" in point ? point.end_pcb_port_id : undefined,
        ],
      )
      .filter(Boolean)
    return { ...element, route: connectedPcbPortIds }
  })
  return serializePadTraceDependencies({
    circuitJson: nameRelevantCircuitJson,
    idToNetMap: options.connMap!.idToNetMap,
    minClearance: options.minClearance,
  })
}

/** Reuses exact complete-trace pad checks; changed traces share one native call. */
export const createPreparedPadTraceClearanceChecker =
  (): PreparedPadTraceClearanceChecker => {
    const cachedByTraceId = new Map<string, CachedTraceErrors>()
    let cachedContextKey: string | undefined
    const stats: PreparedPadTraceClearanceCheckerStats = {
      evaluationCount: 0,
      nativeInvocationCount: 0,
      evaluatedTraceCount: 0,
      cacheHitTraceCount: 0,
    }
    return Object.assign(
      (
        circuitJson: AnyCircuitElement[],
        options: PadTraceClearanceOptions = {},
      ): PadTraceClearanceErrors => {
        stats.evaluationCount++
        const traces = circuitJson.filter(
          (element): element is PcbTrace => element.type === "pcb_trace",
        )
        const hasPads = circuitJson.some(
          (element): boolean =>
            element.type === "pcb_smtpad" || element.type === "pcb_plated_hole",
        )
        if (
          !hasPads ||
          options.connMap == null ||
          !areDrcCopperPairIdentifiersUnambiguous(circuitJson) ||
          !canOmitUnchangedTracesFromNameLookups(circuitJson, traces)
        ) {
          // Empty pad sets need no cache preparation. Implicit connectivity,
          // aliased pair keys and cross-type name shadows are not independent
          // per-trace computations. Evaluate the complete native problem;
          // no failed check is caught or replaced.
          cachedByTraceId.clear()
          cachedContextKey = undefined
          stats.nativeInvocationCount++
          stats.evaluatedTraceCount += traces.length
          return checkPadTraceClearance(circuitJson, options)
        }
        const contextKey = getPadTraceContextKey(circuitJson, options)
        if (contextKey !== cachedContextKey) {
          cachedByTraceId.clear()
          cachedContextKey = contextKey
        }
        const traceKeys = new Map<string, string>()
        const changedTraceIds = new Set<string>()
        for (const trace of traces) {
          const traceKey = serializePadTraceDependencies(trace)
          traceKeys.set(trace.pcb_trace_id, traceKey)
          if (cachedByTraceId.get(trace.pcb_trace_id)?.traceKey === traceKey) {
            stats.cacheHitTraceCount++
          } else {
            changedTraceIds.add(trace.pcb_trace_id)
          }
        }
        // Keep only the latest result for each trace on this board. Removed
        // traces and superseded geometry must not retain old error graphs.
        for (const traceId of cachedByTraceId.keys()) {
          if (!traceKeys.has(traceId)) cachedByTraceId.delete(traceId)
        }
        if (changedTraceIds.size > 0) {
          const partition = circuitJson.filter(
            (element): boolean =>
              element.type !== "pcb_trace" ||
              changedTraceIds.has(element.pcb_trace_id),
          )
          stats.nativeInvocationCount++
          stats.evaluatedTraceCount += changedTraceIds.size
          const errors = checkPadTraceClearance(partition, options)
          const errorsByTraceId = new Map<string, PadTraceClearanceErrors>(
            [...changedTraceIds].map(
              (traceId): [string, PadTraceClearanceErrors] => [traceId, []],
            ),
          )
          for (const error of errors) {
            const traceErrors = errorsByTraceId.get(error.pcb_trace_id)
            if (traceErrors === undefined) {
              throw new Error(
                `Prepared pad-trace check returned an error for unrequested trace "${error.pcb_trace_id}"`,
              )
            }
            traceErrors.push(error)
          }
          for (const [traceId, traceErrors] of errorsByTraceId) {
            const traceKey = traceKeys.get(traceId)
            if (traceKey === undefined) {
              throw new Error(
                `Prepared pad-trace check lost the geometry for trace "${traceId}"`,
              )
            }
            cachedByTraceId.set(traceId, { traceKey, errors: traceErrors })
          }
        }
        const errors: PadTraceClearanceErrors = []
        for (const trace of traces) {
          const cached = cachedByTraceId.get(trace.pcb_trace_id)
          if (cached === undefined) {
            throw new Error(
              `Prepared pad-trace check lost the result for trace "${trace.pcb_trace_id}"`,
            )
          }
          // The native segment traversal is trace-major. Unique pair keys
          // make each trace's insertion order and whole-pair contact
          // suppression independent, without clipping any route segments.
          errors.push(...structuredClone(cached.errors))
        }
        return errors
      },
      {
        getStats: (): Readonly<PreparedPadTraceClearanceCheckerStats> => {
          return {
            evaluationCount: stats.evaluationCount,
            nativeInvocationCount: stats.nativeInvocationCount,
            evaluatedTraceCount: stats.evaluatedTraceCount,
            cacheHitTraceCount: stats.cacheHitTraceCount,
          }
        },
      },
    )
  }
