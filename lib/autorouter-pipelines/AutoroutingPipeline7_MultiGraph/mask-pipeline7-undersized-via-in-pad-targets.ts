import type { SimpleRouteJson } from "lib/types"

/** Prevents via-in-pad moves onto terminal pads that cannot contain the via. */
export const maskPipeline7UndersizedViaInPadTargets = (
  srj: SimpleRouteJson,
  viaDiameter: number,
): SimpleRouteJson => {
  const terminalPortIds = new Set(
    srj.connections.flatMap((connection) =>
      connection.pointsToConnect
        .map((point) => point.pcb_port_id)
        .filter((portId): portId is string => Boolean(portId)),
    ),
  )

  return {
    ...srj,
    obstacles: srj.obstacles.map((obstacle) => {
      if (obstacle.width >= viaDiameter && obstacle.height >= viaDiameter) {
        return obstacle
      }

      return {
        ...obstacle,
        connectedTo: obstacle.connectedTo.filter(
          (connectionId) => !terminalPortIds.has(connectionId),
        ),
      }
    }),
  }
}
