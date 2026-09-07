// Repair01's HighDensityForceImproveSolver materializes XY with
// Math.round(value * ROUNDING_PRECISION) / ROUNDING_PRECISION, where its
// ROUNDING_PRECISION is 1_000. This is an input representation, not a distance
// tolerance or permission to move a fixed endpoint.
const HD_REPAIR_COORDINATE_PRECISION = 1_000

export const matchesPipeline9HdTopologyCoordinate = (
  routeCoordinate: number,
  topologyCoordinate: number,
): boolean => {
  const roundedTopologyCoordinate =
    Math.round(topologyCoordinate * HD_REPAIR_COORDINATE_PRECISION) /
    HD_REPAIR_COORDINATE_PRECISION
  return (
    routeCoordinate === topologyCoordinate ||
    routeCoordinate === roundedTopologyCoordinate
  )
}

/** Conservative ambiguity checks must include the whole input rounding cell. */
export const arePipeline9HdCoordinatesInSameCell = (
  first: number,
  second: number,
): boolean => {
  const firstCell = Math.round(first * HD_REPAIR_COORDINATE_PRECISION)
  const secondCell = Math.round(second * HD_REPAIR_COORDINATE_PRECISION)
  return first === second || firstCell === secondCell
}
