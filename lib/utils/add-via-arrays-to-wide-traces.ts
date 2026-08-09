import type { SimplifiedPcbTrace, SimplifiedPcbTraces } from "lib/types"

type RoutePoint = SimplifiedPcbTrace["route"][number]
type ViaRoutePoint = Extract<RoutePoint, { route_type: "via" }>
type WireRoutePoint = Extract<RoutePoint, { route_type: "wire" }>
type Vector = { x: number; y: number }

type ViaArrayContext = {
  perpendicularDirection: Vector
  traceWidth: number
}

export type AddViaArraysToWideTracesOptions = {
  traces: SimplifiedPcbTraces
  defaultViaDiameter: number
}

const SAME_POINT_TOLERANCE = 1e-9

const getViaArrayContext = (
  route: SimplifiedPcbTrace["route"],
  viaIndex: number,
  via: ViaRoutePoint,
): ViaArrayContext | undefined => {
  let previousWire: WireRoutePoint | undefined
  let previousAnchor: WireRoutePoint | undefined
  for (let index = viaIndex - 1; index >= 0; index -= 1) {
    const point = route[index]
    if (point?.route_type !== "wire") continue
    previousWire ??= point
    if (Math.hypot(point.x - via.x, point.y - via.y) > SAME_POINT_TOLERANCE) {
      previousAnchor = point
      break
    }
  }

  let nextWire: WireRoutePoint | undefined
  let nextAnchor: WireRoutePoint | undefined
  for (let index = viaIndex + 1; index < route.length; index += 1) {
    const point = route[index]
    if (point?.route_type !== "wire") continue
    nextWire ??= point
    if (Math.hypot(point.x - via.x, point.y - via.y) > SAME_POINT_TOLERANCE) {
      nextAnchor = point
      break
    }
  }

  const incomingLength = previousAnchor
    ? Math.hypot(via.x - previousAnchor.x, via.y - previousAnchor.y)
    : 0
  const outgoingLength = nextAnchor
    ? Math.hypot(nextAnchor.x - via.x, nextAnchor.y - via.y)
    : 0
  const incomingDirection = previousAnchor
    ? {
        x: (via.x - previousAnchor.x) / incomingLength,
        y: (via.y - previousAnchor.y) / incomingLength,
      }
    : undefined
  const outgoingDirection = nextAnchor
    ? {
        x: (nextAnchor.x - via.x) / outgoingLength,
        y: (nextAnchor.y - via.y) / outgoingLength,
      }
    : undefined
  const traceDirection = {
    x: (incomingDirection?.x ?? 0) + (outgoingDirection?.x ?? 0),
    y: (incomingDirection?.y ?? 0) + (outgoingDirection?.y ?? 0),
  }
  let traceDirectionLength = Math.hypot(traceDirection.x, traceDirection.y)

  if (traceDirectionLength <= SAME_POINT_TOLERANCE && incomingDirection) {
    traceDirection.x = incomingDirection.x
    traceDirection.y = incomingDirection.y
    traceDirectionLength = 1
  } else if (
    traceDirectionLength <= SAME_POINT_TOLERANCE &&
    outgoingDirection
  ) {
    traceDirection.x = outgoingDirection.x
    traceDirection.y = outgoingDirection.y
    traceDirectionLength = 1
  }

  if (traceDirectionLength <= SAME_POINT_TOLERANCE) return undefined

  return {
    perpendicularDirection: {
      x: -traceDirection.y / traceDirectionLength,
      y: traceDirection.x / traceDirectionLength,
    },
    traceWidth: Math.max(previousWire?.width ?? 0, nextWire?.width ?? 0),
  }
}

export const addViaArraysToWideTraces = ({
  traces,
  defaultViaDiameter,
}: AddViaArraysToWideTracesOptions): SimplifiedPcbTraces => {
  if (!Number.isFinite(defaultViaDiameter) || defaultViaDiameter <= 0) {
    throw new Error("defaultViaDiameter must be a positive finite number")
  }

  return traces.map((trace) => {
    const route: RoutePoint[] = []
    for (let pointIndex = 0; pointIndex < trace.route.length; pointIndex += 1) {
      const point = trace.route[pointIndex]!
      if (point.route_type !== "via") {
        route.push(point)
        continue
      }

      const viaDiameter = point.via_diameter ?? defaultViaDiameter
      if (!Number.isFinite(viaDiameter) || viaDiameter <= 0) {
        throw new Error(
          `Via in trace "${trace.pcb_trace_id}" must have a positive finite diameter`,
        )
      }

      const context = getViaArrayContext(trace.route, pointIndex, point)
      if (
        !context ||
        context.traceWidth <= viaDiameter + SAME_POINT_TOLERANCE
      ) {
        route.push(point)
        continue
      }

      const viaCount = Math.ceil(context.traceWidth / viaDiameter)
      const centerIndex = (viaCount - 1) / 2
      const viaArray = Array.from(
        { length: viaCount },
        (_, viaIndex): ViaRoutePoint => {
          const offset = (viaIndex - centerIndex) * viaDiameter
          return {
            ...point,
            x: point.x + context.perpendicularDirection.x * offset,
            y: point.y + context.perpendicularDirection.y * offset,
          }
        },
      )
      route.push(...viaArray)
    }

    return { ...trace, route }
  })
}
