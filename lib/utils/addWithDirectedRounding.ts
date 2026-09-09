export type RoundingDirection = "up" | "down"

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
  const bitStep = value > 0 === (direction === "up") ? 1n : -1n
  adjacentFloatView.setBigUint64(0, bits + bitStep)
  const adjacent = adjacentFloatView.getFloat64(0)
  if (!Number.isFinite(adjacent)) {
    throw new Error(
      "placeOrderedPortsInClearanceIntervals cannot represent a directed bound",
    )
  }
  return adjacent
}

export const addWithDirectedRounding = (
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
