import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SharedEdge } from "./types"

export type FixedRouteBlockedInterval = {
  start: number
  end: number
}

type EdgePoint = { axis: number; normal: number }

/** Evaluate a near-contact axis gap from the declared decimal coordinates, without moving them. */
const getParallelContactInterval = (
  start: EdgePoint,
  end: EdgePoint,
  fixedNormal: number,
  edgeNormal: number,
  fixedWidth: number,
  traceWidth: number,
  clearance: number,
): FixedRouteBlockedInterval | null | undefined => {
  const gap = Math.abs(fixedNormal - edgeNormal)
  const radius = (fixedWidth + traceWidth) / 2 + clearance
  const roundingBound = 4 * Number.EPSILON *
    (Math.abs(fixedNormal) + Math.abs(edgeNormal) + fixedWidth + traceWidth + 2 * clearance)
  if (Math.abs(gap - radius) > roundingBound) return undefined
  const sign = fixedNormal >= edgeNormal ? 1n : -1n
  const terms = [
    [fixedNormal, 2n * sign], [edgeNormal, -2n * sign],
    [fixedWidth, -1n], [traceWidth, -1n], [clearance, -2n],
  ] as const
  const decimals = terms.map(([value, multiplier]) => {
    const [mantissa, rawExponent] = value.toString().split("e")
    const decimalPlaces = mantissa!.split(".")[1]?.length ?? 0
    return { coefficient: BigInt(mantissa!.replace(".", "")) * multiplier,
      exponent: Number(rawExponent ?? 0) - decimalPlaces }
  })
  const exponent = Math.min(...decimals.map((decimal) => decimal.exponent))
  const twiceGapMinusDiameter = decimals.reduce((sum, decimal) =>
    sum + decimal.coefficient * 10n ** BigInt(decimal.exponent - exponent), 0n)
  if (twiceGapMinusDiameter >= 0n) return null
  const penetration = Number(-twiceGapMinusDiameter) * 10 ** exponent / 2
  const halfCapLength = Math.sqrt(penetration * (radius + gap))
  return { start: Math.min(start.axis, end.axis) - halfCapLength,
    end: Math.max(start.axis, end.axis) + halfCapLength }
}

type FixedRouteBlockedIntervalsInput = {
  sharedEdge: SharedEdge
  fixedRoutes: ReadonlyArray<HighDensityRoute>
  z: number
  netId: string
  traceWidth: number
  clearance: number
  netByConnectionName: ReadonlyMap<string, string>
}

const getCircleInterval = (
  center: EdgePoint,
  radius: number,
): FixedRouteBlockedInterval | null => {
  const normalDistance = Math.abs(center.normal)
  if (normalDistance >= radius) return null
  const halfLength = Math.sqrt(
    (radius - normalDistance) * (radius + normalDistance),
  )
  return {
    start: center.axis - halfLength,
    end: center.axis + halfLength,
  }
}

/** Intersects an open capsule with the infinite line containing the edge. */
const getCapsuleInterval = (
  start: EdgePoint,
  end: EdgePoint,
  radius: number,
): FixedRouteBlockedInterval | null => {
  const intervals: FixedRouteBlockedInterval[] = []
  const startCircle = getCircleInterval(start, radius)
  const endCircle = getCircleInterval(end, radius)
  if (startCircle) intervals.push(startCircle)
  if (endCircle) intervals.push(endCircle)

  const axisDelta = end.axis - start.axis
  const normalDelta = end.normal - start.normal
  const segmentLength = Math.hypot(axisDelta, normalDelta)
  if (segmentLength > 0) {
    const axisDirection = axisDelta / segmentLength
    const normalDirection = normalDelta / segmentLength
    let stripStart = -Infinity
    let stripEnd = Infinity

    // The capsule body is the distance strip clipped to the segment's
    // perpendicular end planes. Endpoint disks supply the rounded caps.
    if (normalDirection === 0) {
      if (Math.abs(start.normal) >= radius) stripEnd = -Infinity
    } else {
      const offset =
        normalDirection * start.axis - axisDirection * start.normal
      const firstRoot = (offset - radius) / normalDirection
      const secondRoot = (offset + radius) / normalDirection
      stripStart = Math.min(firstRoot, secondRoot)
      stripEnd = Math.max(firstRoot, secondRoot)
    }

    if (axisDirection === 0) {
      const projection = -normalDirection * start.normal
      if (projection < 0 || projection > segmentLength) stripEnd = -Infinity
    } else {
      const firstPlane =
        start.axis + (normalDirection * start.normal) / axisDirection
      const secondPlane = firstPlane + segmentLength / axisDirection
      stripStart = Math.max(stripStart, Math.min(firstPlane, secondPlane))
      stripEnd = Math.min(stripEnd, Math.max(firstPlane, secondPlane))
    }

    if (stripStart < stripEnd) {
      intervals.push({ start: stripStart, end: stripEnd })
    }
  }

  if (intervals.length === 0) return null
  // A capsule is convex, so its line intersection is one interval.
  return {
    start: Math.min(...intervals.map((interval) => interval.start)),
    end: Math.max(...intervals.map((interval) => interval.end)),
  }
}

/**
 * Returns forbidden open intervals along the shared edge for one movable
 * trace. Roots remain outside [0, length] when copper covers an edge endpoint;
 * clipping them would incorrectly make that endpoint available.
 */
export const getFixedRouteBlockedIntervals = ({
  sharedEdge,
  fixedRoutes,
  z,
  netId,
  traceWidth,
  clearance,
  netByConnectionName,
}: FixedRouteBlockedIntervalsInput): FixedRouteBlockedInterval[] => {
  const failGeometry = (description: string): never => {
    throw new Error(
      `UniformPortDistributionInvalidFixedRouteGeometry: ${description}`,
    )
  }
  if (
    !Number.isInteger(z) ||
    z < 0 ||
    !Number.isFinite(traceWidth) ||
    traceWidth <= 0 ||
    !Number.isFinite(clearance) ||
    clearance < 0 ||
    !netId
  ) {
    failGeometry(`invalid movable trace on edge "${sharedEdge.ownerPairKey}"`)
  }
  const horizontal = sharedEdge.orientation === "horizontal"
  const edgeStart = horizontal ? sharedEdge.x1 : sharedEdge.y1
  const edgeEnd = horizontal ? sharedEdge.x2 : sharedEdge.y2
  const edgeNormal = horizontal ? sharedEdge.y1 : sharedEdge.x1
  if (
    ![sharedEdge.x1, sharedEdge.x2, sharedEdge.y1, sharedEdge.y2].every(
      Number.isFinite,
    ) ||
    (horizontal
      ? sharedEdge.y1 !== sharedEdge.y2
      : sharedEdge.x1 !== sharedEdge.x2) ||
    !Number.isFinite(sharedEdge.length) || sharedEdge.length < 0 ||
    edgeEnd - edgeStart !== sharedEdge.length
  ) {
    failGeometry(`invalid shared edge "${sharedEdge.ownerPairKey}"`)
  }

  const intervals: FixedRouteBlockedInterval[] = []
  for (const route of fixedRoutes) {
    const fixedNet =
      (route.rootConnectionName === undefined
        ? undefined
        : netByConnectionName.get(route.rootConnectionName)) ??
      netByConnectionName.get(route.connectionName)
    if (fixedNet === undefined) {
      throw new Error(
        `UniformPortDistributionMissingFixedRouteNetIdentity: route "${route.connectionName}" has no canonical net`,
      )
    }
    if (fixedNet === netId) continue
    if (route.route.length < 2) {
      failGeometry(`route "${route.connectionName}" has fewer than two points`)
    }
    for (const point of route.route) {
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isInteger(point.z) ||
        point.z < 0
      ) {
        failGeometry(`route "${route.connectionName}" has an invalid point`)
      }
    }
    for (let index = 1; index < route.route.length; index++) {
      const start = route.route[index - 1]!
      const end = route.route[index]!
      const startOnEdge: EdgePoint = {
        axis: (horizontal ? start.x : start.y) - edgeStart,
        normal: (horizontal ? start.y : start.x) - edgeNormal,
      }
      let interval: FixedRouteBlockedInterval | null
      if (start.z !== end.z) {
        if (start.x !== end.x || start.y !== end.y) {
          failGeometry(
            `route "${route.connectionName}" segment ${index - 1} changes layer and position without a materialized via`,
          )
        }
        if (!Number.isFinite(route.viaDiameter) || route.viaDiameter <= 0) {
          failGeometry(`route "${route.connectionName}" has an invalid via diameter`)
        }
        if (z < Math.min(start.z, end.z) || z > Math.max(start.z, end.z)) {
          continue
        }
        interval = getCircleInterval(
          startOnEdge,
          (route.viaDiameter + traceWidth) / 2 + clearance,
        )
      } else {
        const startWidth = start.traceThickness ?? route.traceThickness
        const endWidth = end.traceThickness ?? route.traceThickness
        if (
          !Number.isFinite(startWidth) ||
          startWidth <= 0 ||
          !Number.isFinite(endWidth) ||
          endWidth <= 0
        ) {
          failGeometry(`route "${route.connectionName}" has an invalid wire width`)
        }
        if (start.z !== z) continue
        const endOnEdge = {
            axis: (horizontal ? end.x : end.y) - edgeStart,
            normal: (horizontal ? end.y : end.x) - edgeNormal,
        }
        const fixedWidth = Math.max(startWidth, endWidth)
        const parallel = horizontal ? start.y === end.y : start.x === end.x
        const exactContact = parallel ? getParallelContactInterval(startOnEdge, endOnEdge,
          horizontal ? start.y : start.x, edgeNormal, fixedWidth, traceWidth, clearance) : undefined
        interval = exactContact === undefined
          ? getCapsuleInterval(startOnEdge, endOnEdge, (fixedWidth + traceWidth) / 2 + clearance)
          : exactContact
      }
      if (!interval) continue
      if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end)) {
        failGeometry(`route "${route.connectionName}" has non-finite interval roots`)
      }
      if (interval.end > 0 && interval.start < sharedEdge.length) {
        intervals.push(interval)
      }
    }
  }

  intervals.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: FixedRouteBlockedInterval[] = []
  for (const interval of intervals) {
    const previous = merged[merged.length - 1]
    // Touching open intervals leave an exactly-clear point between them.
    if (previous && interval.start < previous.end) {
      previous.end = Math.max(previous.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged
}
