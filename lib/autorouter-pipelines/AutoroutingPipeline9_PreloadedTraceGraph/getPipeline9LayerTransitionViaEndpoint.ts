import type { HighDensityRoute } from "lib/types/high-density-types"

type Pipeline9LayerTransitionViaEndpoint = "start" | "end" | "colocated"

const POSITION_EPSILON = 1e-6

/** Resolves board-world millimetre endpoints using the explicit routed vias. */
export const getPipeline9LayerTransitionViaEndpoint = ({
  hdRoute,
  start,
  end,
}: {
  hdRoute: HighDensityRoute
  start: HighDensityRoute["route"][number]
  end: HighDensityRoute["route"][number]
}): Pipeline9LayerTransitionViaEndpoint => {
  if (
    Math.abs(start.x - end.x) <= POSITION_EPSILON &&
    Math.abs(start.y - end.y) <= POSITION_EPSILON
  ) {
    return "colocated"
  }

  const hasViaAtStart = hdRoute.vias.some(
    (via) =>
      Math.abs(via.x - start.x) <= POSITION_EPSILON &&
      Math.abs(via.y - start.y) <= POSITION_EPSILON,
  )
  const hasViaAtEnd = hdRoute.vias.some(
    (via) =>
      Math.abs(via.x - end.x) <= POSITION_EPSILON &&
      Math.abs(via.y - end.y) <= POSITION_EPSILON,
  )
  if (!hasViaAtStart && !hasViaAtEnd) {
    throw new Error(
      `Pipeline9 route "${hdRoute.connectionName}" changes layers from z=${start.z} to z=${end.z} without an explicit via`,
    )
  }
  if (hasViaAtStart === hasViaAtEnd) {
    throw new Error(
      `Pipeline9 route "${hdRoute.connectionName}" has an ambiguous layer transition between (${start.x}, ${start.y}) and (${end.x}, ${end.y})`,
    )
  }
  return hasViaAtStart ? "start" : "end"
}
