import { checkPadTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { areDelimiterPrefixesUnique } from "./areDrcCopperPairIdentifiersUnambiguous"

type PadTraceClearanceOptions = NonNullable<
  Parameters<typeof checkPadTraceClearance>[1]
>
type PadTraceClearanceErrors = ReturnType<typeof checkPadTraceClearance>
type TraceCacheEntry = {
  key: string
  errors: PadTraceClearanceErrors
}
type PadTraceCacheInputs = {
  contextKey: string
  traces: Array<{ trace: PcbTrace; key: string }>
}

export type PreparedPadTraceClearanceCheckerStats = {
  evaluationCount: number
  nativeInvocationCount: number
  // Trace counts cover eligible serialized input, not unsupported dynamic
  // objects whose properties the native computation must read for itself.
  totalTraceCount: number
  cachedTraceCount: number
  nativeCheckedTraceCount: number
  cacheEligibleEvaluationCount: number
}

export type PreparedPadTraceClearanceChecker = {
  (
    circuitJson: AnyCircuitElement[],
    options?: PadTraceClearanceOptions,
  ): PadTraceClearanceErrors
  getStats: () => Readonly<PreparedPadTraceClearanceCheckerStats>
}

const isPlainPadTraceCacheData = (
  value: unknown,
  ancestors: Set<object>,
): boolean => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true
  }
  if (typeof value !== "object" || ancestors.has(value)) return false
  const isArray = Array.isArray(value)
  if (
    Object.getPrototypeOf(value) !==
    (isArray ? Array.prototype : Object.prototype)
  ) {
    return false
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(descriptors)
  if (isArray && keys.length !== value.length + 1) return false
  ancestors.add(value)
  for (const key of keys) {
    if (typeof key !== "string") return false
    if (isArray && key === "length") continue
    const descriptor = descriptors[key]!
    if (
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      (isArray &&
        (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) ||
      !isPlainPadTraceCacheData(descriptor.value, ancestors)
    ) {
      return false
    }
  }
  ancestors.delete(value)
  return true
}

const getPadTraceCacheDataKey = (value: unknown): string => {
  return JSON.stringify(value, (_key: string, item: unknown): unknown => {
    // Own-property presence matters to native width selection. Preserve
    // undefined, null, -0 and nonfinite numbers; tag strings to avoid aliases.
    if (typeof item === "number") {
      return `number:${Object.is(item, -0) ? "-0" : String(item)}`
    }
    if (typeof item === "string") return `string:${item}`
    if (item === undefined) return "undefined:"
    if (item === null) return "null:"
    return item
  })
}

const getPadTraceCacheInputs = (
  circuitJson: AnyCircuitElement[],
  options: PadTraceClearanceOptions,
): PadTraceCacheInputs | undefined => {
  if (
    !Array.isArray(circuitJson) ||
    Object.getPrototypeOf(circuitJson) !== Array.prototype ||
    !Object.isExtensible(circuitJson) ||
    Object.getOwnPropertyDescriptor(circuitJson, "filter") !== undefined ||
    Object.getOwnPropertyDescriptor(circuitJson, "find") !== undefined ||
    Object.getOwnPropertyDescriptor(circuitJson, Symbol.iterator) !==
      undefined ||
    options === null ||
    typeof options !== "object" ||
    Object.getPrototypeOf(options) !== Object.prototype
  ) {
    return undefined
  }
  const optionDescriptors = Object.getOwnPropertyDescriptors(options)
  const mapDescriptor = optionDescriptors.connMap
  const clearanceDescriptor = optionDescriptors.minClearance
  if (
    !mapDescriptor ||
    !("value" in mapDescriptor) ||
    (clearanceDescriptor && !("value" in clearanceDescriptor))
  ) {
    return undefined
  }
  const connMap: unknown = mapDescriptor.value
  const minClearance: unknown = clearanceDescriptor?.value
  if (
    connMap === null ||
    typeof connMap !== "object" ||
    Object.getPrototypeOf(connMap) !== ConnectivityMap.prototype ||
    Object.getOwnPropertyDescriptor(connMap, "areIdsConnected") !== undefined ||
    Object.getOwnPropertyDescriptor(connMap, "getNetConnectedToId") !==
      undefined ||
    (minClearance !== undefined &&
      minClearance !== null &&
      typeof minClearance !== "number")
  ) {
    return undefined
  }
  const idMapDescriptor = Object.getOwnPropertyDescriptor(connMap, "idToNetMap")
  if (
    !idMapDescriptor ||
    !("value" in idMapDescriptor) ||
    !isPlainPadTraceCacheData(idMapDescriptor.value, new Set())
  ) {
    return undefined
  }

  const traceIds = new Set<string>()
  const padIds = new Set<string>()
  const traces: PadTraceCacheInputs["traces"] = []
  const orderedContext: unknown[] = []
  for (let index = 0; index < circuitJson.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(circuitJson, index)
    if (!descriptor || !("value" in descriptor)) return undefined
    const element: AnyCircuitElement = descriptor.value
    if (
      !isPlainPadTraceCacheData(element, new Set()) ||
      element === null ||
      typeof element !== "object" ||
      typeof element.type !== "string"
    ) {
      return undefined
    }
    const primaryId = Object.getOwnPropertyDescriptor(
      element,
      `${element.type}_id`,
    )?.value
    // A fresh miss array initializes CJU's ID counts. Do not introduce its
    // .split exception when a previously initialized full array would not.
    if (primaryId && typeof primaryId !== "string") return undefined
    if (element.type === "pcb_trace") {
      if (
        typeof primaryId !== "string" ||
        !primaryId ||
        traceIds.has(primaryId)
      ) {
        return undefined
      }
      traceIds.add(primaryId)
      traces.push({ trace: element, key: getPadTraceCacheDataKey(element) })
      orderedContext.push(["trace"])
    } else {
      if (
        element.type === "pcb_smtpad" ||
        element.type === "pcb_plated_hole"
      ) {
        if (
          typeof primaryId !== "string" ||
          !primaryId ||
          padIds.has(primaryId)
        ) {
          return undefined
        }
        padIds.add(primaryId)
      }
      orderedContext.push(["metadata", element])
    }
  }
  if (
    !areDelimiterPrefixesUnique(padIds) ||
    [...traceIds].some((identifier): boolean => padIds.has(identifier))
  ) {
    return undefined
  }
  // Native name lookup can select an earlier nontrace primary-ID shadow,
  // which remains in the context in exact order. An omitted hit trace cannot
  // shadow a selected trace/pad ID under the unique/disjoint proof above.
  return {
    contextKey: getPadTraceCacheDataKey({
      orderedContext,
      idToNetMap: idMapDescriptor.value,
      hasMinClearance: clearanceDescriptor !== undefined,
      minClearance,
    }),
    traces,
  }
}

/** Reuses complete native trace results at the prepared post-overlap phase. */
export const createPreparedPadTraceClearanceChecker =
  (): PreparedPadTraceClearanceChecker => {
    let contextKey: string | undefined
    let entries = new Map<number, TraceCacheEntry>()
    const stats: PreparedPadTraceClearanceCheckerStats = {
      evaluationCount: 0,
      nativeInvocationCount: 0,
      totalTraceCount: 0,
      cachedTraceCount: 0,
      nativeCheckedTraceCount: 0,
      cacheEligibleEvaluationCount: 0,
    }
    return Object.assign(
      (
        circuitJson: AnyCircuitElement[],
        options: PadTraceClearanceOptions = {},
      ): PadTraceClearanceErrors => {
        stats.evaluationCount++
        const inputs = getPadTraceCacheInputs(circuitJson, options)
        if (inputs === undefined || inputs.traces.length === 0) {
          contextKey = undefined
          entries.clear()
          stats.nativeInvocationCount++
          return checkPadTraceClearance(circuitJson, options)
        }
        stats.cacheEligibleEvaluationCount++
        stats.totalTraceCount += inputs.traces.length
        const previousEntries =
          contextKey === inputs.contextKey
            ? entries
            : new Map<number, TraceCacheEntry>()
        const missingTraceIds = new Set<string>()
        for (const [ordinal, { trace, key }] of inputs.traces.entries()) {
          if (previousEntries.get(ordinal)?.key === key) {
            stats.cachedTraceCount++
          } else {
            missingTraceIds.add(trace.pcb_trace_id)
          }
        }
        const freshErrorsByTrace = new Map<string, PadTraceClearanceErrors>()
        for (const identifier of missingTraceIds) {
          freshErrorsByTrace.set(identifier, [])
        }
        if (missingTraceIds.size > 0) {
          // The native checker processes complete traces contiguously. Unique
          // pad-prefixed pair keys make their Map insertion/deletion groups
          // independent; all misses share one unchanged native pad index.
          const nativeInput =
            missingTraceIds.size === inputs.traces.length
              ? circuitJson
              : circuitJson.filter(
                  (element): boolean =>
                    element.type !== "pcb_trace" ||
                    missingTraceIds.has(element.pcb_trace_id),
                )
          stats.nativeInvocationCount++
          stats.nativeCheckedTraceCount += missingTraceIds.size
          const freshErrors = checkPadTraceClearance(nativeInput, options)
          for (const error of freshErrors) {
            const group = freshErrorsByTrace.get(error.pcb_trace_id)
            if (group === undefined) {
              throw new Error(
                "Native pad clearance returned an unrequested trace",
              )
            }
            group.push(error)
          }
        }
        const nextEntries = new Map<number, TraceCacheEntry>()
        const result: PadTraceClearanceErrors = []
        for (const [ordinal, { trace, key }] of inputs.traces.entries()) {
          const previous = previousEntries.get(ordinal)
          if (previous?.key === key) {
            nextEntries.set(ordinal, previous)
            for (const error of structuredClone(previous.errors)) {
              result.push(error)
            }
          } else {
            const errors = freshErrorsByTrace.get(trace.pcb_trace_id)
            if (errors === undefined) {
              throw new Error("Native pad clearance result group is missing")
            }
            nextEntries.set(ordinal, { key, errors: structuredClone(errors) })
            for (const error of errors) result.push(error)
          }
        }
        // Publish only successful results, with at most one current geometry
        // per trace ordinal. Public arrays/centers never alias retained errors.
        contextKey = inputs.contextKey
        entries = nextEntries
        return result
      },
      {
        getStats: (): Readonly<PreparedPadTraceClearanceCheckerStats> => ({
          ...stats,
        }),
      },
    )
  }
