import type { SimplifiedPcbTrace, SimplifiedPcbTraces } from "lib/types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type RoutePoint = SimplifiedPcbTrace["route"][number]
export type ViaRoutePoint = Extract<RoutePoint, { route_type: "via" }>

export type GeneratedViaRef = {
  trace: SimplifiedPcbTrace
  routeIndex: number
  via: ViaRoutePoint
}

export const shouldUseThroughVias = (
  allowBlindAndBuriedVias: boolean | undefined,
): boolean => {
  if (allowBlindAndBuriedVias === undefined) return false
  if (allowBlindAndBuriedVias === true) return false
  if (allowBlindAndBuriedVias === false) return true
  throw new Error("allowBlindAndBuriedVias must be a boolean when provided")
}

const getViaIdentity = (via: ViaRoutePoint): string =>
  JSON.stringify([
    via.x,
    via.y,
    via.from_layer,
    via.to_layer,
    via.via_diameter ?? null,
    via.via_hole_diameter ?? null,
  ])

const getInputViaCountsByTraceId = (
  inputTraces: ReadonlyArray<SimplifiedPcbTrace>,
): Map<string, Map<string, number>> => {
  const countsByTraceId = new Map<string, Map<string, number>>()
  for (const trace of inputTraces) {
    const counts = countsByTraceId.get(trace.pcb_trace_id) ?? new Map()
    for (const routePoint of trace.route) {
      if (routePoint.route_type !== "via") continue
      const identity = getViaIdentity(routePoint)
      counts.set(identity, (counts.get(identity) ?? 0) + 1)
    }
    countsByTraceId.set(trace.pcb_trace_id, counts)
  }
  return countsByTraceId
}

const consumeMatchingInputVia = ({
  trace,
  via,
  inputViaCountsByTraceId,
}: {
  trace: SimplifiedPcbTrace
  via: ViaRoutePoint
  inputViaCountsByTraceId: Map<string, Map<string, number>>
}): boolean => {
  const identity = getViaIdentity(via)
  const candidateTraceIds = [
    trace.pcb_trace_id,
    trace.__replaces_pcb_trace_id,
  ].filter((traceId): traceId is string => traceId !== undefined)

  for (const traceId of candidateTraceIds) {
    const counts = inputViaCountsByTraceId.get(traceId)
    const count = counts?.get(identity) ?? 0
    if (count === 0) continue
    counts!.set(identity, count - 1)
    return true
  }
  return false
}

export const getGeneratedViaRefs = ({
  inputTraces,
  outputTraces,
}: {
  inputTraces: ReadonlyArray<SimplifiedPcbTrace>
  outputTraces: ReadonlyArray<SimplifiedPcbTrace>
}): GeneratedViaRef[] => {
  const inputViaCountsByTraceId = getInputViaCountsByTraceId(inputTraces)
  const generatedVias: GeneratedViaRef[] = []
  for (const trace of outputTraces) {
    for (const [routeIndex, routePoint] of trace.route.entries()) {
      if (routePoint.route_type !== "via") continue
      if (
        consumeMatchingInputVia({
          trace,
          via: routePoint,
          inputViaCountsByTraceId,
        })
      ) {
        continue
      }
      generatedVias.push({ trace, routeIndex, via: routePoint })
    }
  }
  return generatedVias
}

export const materializeGeneratedThroughVias = ({
  inputTraces,
  outputTraces,
  layerCount,
  allowBlindAndBuriedVias,
}: {
  inputTraces: ReadonlyArray<SimplifiedPcbTrace>
  outputTraces: SimplifiedPcbTraces
  layerCount: number
  allowBlindAndBuriedVias: boolean | undefined
}): SimplifiedPcbTraces => {
  if (!shouldUseThroughVias(allowBlindAndBuriedVias)) return outputTraces

  const generatedViaIndexesByTrace = new Map<SimplifiedPcbTrace, Set<number>>()
  for (const { trace, routeIndex } of getGeneratedViaRefs({
    inputTraces,
    outputTraces,
  })) {
    const routeIndexes = generatedViaIndexesByTrace.get(trace) ?? new Set()
    routeIndexes.add(routeIndex)
    generatedViaIndexesByTrace.set(trace, routeIndexes)
  }
  const fromLayer = mapZToLayerName(0, layerCount)
  const toLayer = mapZToLayerName(layerCount - 1, layerCount)

  return outputTraces.map((trace) => ({
    ...trace,
    route: trace.route.map((routePoint, routeIndex) =>
      routePoint.route_type === "via" &&
      generatedViaIndexesByTrace.get(trace)?.has(routeIndex)
        ? { ...routePoint, from_layer: fromLayer, to_layer: toLayer }
        : routePoint,
    ),
  }))
}
