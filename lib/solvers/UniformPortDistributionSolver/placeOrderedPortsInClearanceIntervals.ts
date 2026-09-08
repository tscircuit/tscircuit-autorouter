import type { FixedCopperClearanceInterval } from "./getFixedCopperClearanceIntervals"

/** One physical port in the caller's already established shared-edge order. */
export type OrderedPhysicalPort = {
  readonly allowedIntervals: readonly Readonly<FixedCopperClearanceInterval>[]
  readonly uniformTarget: number
  readonly canonicalNetId: string
  readonly copperDiameter: number
}

type PreparedPort = {
  port: OrderedPhysicalPort
  radius: number
}

type RoundingDirection = "up" | "down"

const adjacentFloatView = new DataView(new ArrayBuffer(8))

const getAdjacentFloat = (
  value: number,
  direction: RoundingDirection,
): number => {
  if (value === 0) {
    return direction === "up" ? Number.MIN_VALUE : -Number.MIN_VALUE
  }
  adjacentFloatView.setFloat64(0, value)
  const bits = adjacentFloatView.getBigUint64(0)
  const bitStep = (value > 0) === (direction === "up") ? 1n : -1n
  adjacentFloatView.setBigUint64(0, bits + bitStep)
  const adjacent = adjacentFloatView.getFloat64(0)
  if (!Number.isFinite(adjacent)) {
    throw new Error(
      "placeOrderedPortsInClearanceIntervals cannot represent a directed bound",
    )
  }
  return adjacent
}

const addWithDirectedRounding = (
  first: number,
  second: number,
  direction: RoundingDirection,
): number => {
  const sum = first + second
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(second) ||
    !Number.isFinite(sum)
  ) {
    throw new Error(
      "placeOrderedPortsInClearanceIntervals cannot represent a finite directed sum",
    )
  }
  // A zero offset is exact and need not change the sign of a zero anchor.
  if (second === 0) return first
  // TwoSum gives the exact residual of the nearest-rounded binary64 addition.
  // Move one representable value only if that residual requires this direction.
  const recoveredSecond = sum - first
  const residual = first - (sum - recoveredSecond) + (second - recoveredSecond)
  if (!Number.isFinite(residual)) {
    throw new Error(
      "placeOrderedPortsInClearanceIntervals cannot represent a sum residual",
    )
  }
  if (
    (direction === "up" && residual > 0) ||
    (direction === "down" && residual < 0)
  ) {
    return getAdjacentFloat(sum, direction)
  }
  return sum
}

const getRequiredSpacing = (
  first: PreparedPort,
  second: PreparedPort,
  traceGap: number,
): number => {
  if (first.port.canonicalNetId === second.port.canonicalNetId) return 0
  const spacing = first.radius + second.radius + traceGap
  if (!Number.isFinite(spacing)) {
    throw new Error(
      "placeOrderedPortsInClearanceIntervals cannot represent physical spacing",
    )
  }
  return spacing
}

/**
 * Places a fixed port order in closed legal interval unions. Fixed anchors are
 * singleton intervals; identity coalescing belongs to the caller. Every pair
 * constrains spacing, because adjacent same-net ports can have unequal widths.
 *
 * The backward pass reserves a feasible suffix. The forward pass selects the
 * nearest existing uniform target within that reservation, preferring the lower
 * coordinate on an exact tie. This is not a reordered or least-squares solve.
 */
export const placeOrderedPortsInClearanceIntervals = (params: {
  readonly ports: readonly OrderedPhysicalPort[]
  readonly traceGap: number
}): number[] => {
  if (!Number.isFinite(params.traceGap) || params.traceGap < 0) {
    throw new Error(
      "placeOrderedPortsInClearanceIntervals requires a finite nonnegative trace gap",
    )
  }
  const preparedPorts: PreparedPort[] = []
  for (let index = 0; index < params.ports.length; index++) {
    const port = params.ports[index]
    const radius = port.copperDiameter / 2
    if (
      !Number.isFinite(port.uniformTarget) ||
      !Number.isFinite(port.copperDiameter) ||
      port.copperDiameter <= 0 ||
      radius <= 0 ||
      typeof port.canonicalNetId !== "string" ||
      port.canonicalNetId.length === 0
    ) {
      throw new Error(
        `placeOrderedPortsInClearanceIntervals has invalid physical inputs at port ${index}`,
      )
    }
    for (const interval of port.allowedIntervals) {
      if (
        !Number.isFinite(interval.start) ||
        !Number.isFinite(interval.end) ||
        interval.start > interval.end
      ) {
        throw new Error(
          `placeOrderedPortsInClearanceIntervals has an invalid closed interval at port ${index}`,
        )
      }
    }
    preparedPorts.push({ port, radius })
  }

  const latest: number[] = new Array(preparedPorts.length)
  for (let index = preparedPorts.length - 1; index >= 0; index--) {
    const current = preparedPorts[index]
    let upperBound = Number.POSITIVE_INFINITY
    for (let laterIndex = index + 1; laterIndex < latest.length; laterIndex++) {
      const spacing = getRequiredSpacing(
        current,
        preparedPorts[laterIndex],
        params.traceGap,
      )
      const pairUpperBound = addWithDirectedRounding(
        latest[laterIndex],
        -spacing,
        "down",
      )
      if (!Number.isFinite(pairUpperBound)) {
        throw new Error(
          `placeOrderedPortsInClearanceIntervals cannot represent an upper bound at port ${index}`,
        )
      }
      upperBound = Math.min(upperBound, pairUpperBound)
    }
    let latestCoordinate: number | undefined
    for (const interval of current.port.allowedIntervals) {
      const coordinate = Math.min(interval.end, upperBound)
      if (
        coordinate >= interval.start &&
        (latestCoordinate === undefined || coordinate > latestCoordinate)
      ) {
        latestCoordinate = coordinate
      }
    }
    if (latestCoordinate === undefined) {
      throw new Error(
        `placeOrderedPortsInClearanceIntervals: infeasible ordered placement at port ${index}`,
      )
    }
    latest[index] = latestCoordinate
  }

  const positions: number[] = []
  for (let index = 0; index < preparedPorts.length; index++) {
    const current = preparedPorts[index]
    let lowerBound = Number.NEGATIVE_INFINITY
    for (let earlierIndex = 0; earlierIndex < index; earlierIndex++) {
      const spacing = getRequiredSpacing(
        preparedPorts[earlierIndex],
        current,
        params.traceGap,
      )
      const pairLowerBound = addWithDirectedRounding(
        positions[earlierIndex],
        spacing,
        "up",
      )
      if (!Number.isFinite(pairLowerBound)) {
        throw new Error(
          `placeOrderedPortsInClearanceIntervals cannot represent a lower bound at port ${index}`,
        )
      }
      lowerBound = Math.max(lowerBound, pairLowerBound)
    }
    let nearestCoordinate: number | undefined
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const interval of current.port.allowedIntervals) {
      const start = Math.max(interval.start, lowerBound)
      const end = Math.min(interval.end, latest[index])
      if (start > end) continue
      const coordinate = Math.max(
        start,
        Math.min(current.port.uniformTarget, end),
      )
      const targetDistance = Math.abs(coordinate - current.port.uniformTarget)
      if (!Number.isFinite(targetDistance)) {
        throw new Error(
          `placeOrderedPortsInClearanceIntervals cannot represent a target distance at port ${index}`,
        )
      }
      if (
        nearestCoordinate === undefined ||
        targetDistance < nearestDistance ||
        (targetDistance === nearestDistance && coordinate < nearestCoordinate)
      ) {
        nearestCoordinate = coordinate
        nearestDistance = targetDistance
      }
    }
    if (nearestCoordinate === undefined) {
      throw new Error(
        `placeOrderedPortsInClearanceIntervals: infeasible ordered placement at port ${index}`,
      )
    }
    positions.push(nearestCoordinate)
  }

  // Do not silently accept a rounded bound that violates a physical constraint.
  for (let index = 0; index < positions.length; index++) {
    for (let laterIndex = index + 1; laterIndex < positions.length; laterIndex++) {
      const spacing = getRequiredSpacing(
        preparedPorts[index],
        preparedPorts[laterIndex],
        params.traceGap,
      )
      const separation = positions[laterIndex] - positions[index]
      if (!Number.isFinite(separation) || separation < spacing) {
        throw new Error(
          `placeOrderedPortsInClearanceIntervals cannot represent valid spacing between ports ${index} and ${laterIndex}`,
        )
      }
    }
  }
  return positions
}
