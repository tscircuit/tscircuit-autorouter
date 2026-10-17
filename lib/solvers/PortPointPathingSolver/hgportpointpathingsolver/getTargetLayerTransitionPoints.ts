import {
  isPointInsidePolygon,
  pointToBoxDistance,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type {
  ConnectionPoint,
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { isSingleLayerConnectionPoint } from "lib/types"

export type LayerTransitionPoint = {
  x: number
  y: number
  connectionName: string
}

const pointIsInsideObstacle = (
  point: { x: number; y: number },
  obstacle: Obstacle,
): boolean =>
  Math.abs(point.x - obstacle.center.x) <= obstacle.width / 2 &&
  Math.abs(point.y - obstacle.center.y) <= obstacle.height / 2

const obstacleMatchesConnection = (
  obstacle: Obstacle,
  connection: SimpleRouteConnection,
): boolean => {
  const connectionIds = new Set([
    connection.name,
    ...(connection.__rootConnectionNames ?? []),
    ...connection.pointsToConnect.flatMap((point) =>
      [point.pointId, point.pcb_port_id].filter(
        (id): id is string => id !== undefined,
      ),
    ),
  ])
  return obstacle.connectedTo.some((id) => connectionIds.has(id))
}

const getTerminalObstacle = ({
  point,
  connection,
  obstacles,
}: {
  point: ConnectionPoint
  connection: SimpleRouteConnection
  obstacles: Obstacle[]
}): Obstacle | undefined => {
  if (!isSingleLayerConnectionPoint(point)) return undefined
  return obstacles
    .filter(
      (obstacle) =>
        obstacle.layers.includes(point.layer) &&
        pointIsInsideObstacle(point, obstacle) &&
        obstacleMatchesConnection(obstacle, connection),
    )
    .sort((a, b) => a.width * a.height - b.width * b.height)[0]
}

const pointKey = (point: LayerTransitionPoint): string =>
  `${point.connectionName}:${point.x.toFixed(6)},${point.y.toFixed(6)}`

const pointHasBoardClearance = ({
  point,
  srj,
  clearance,
}: {
  point: { x: number; y: number }
  srj: SimpleRouteJson
  clearance: number
}): boolean => {
  if (
    point.x < srj.bounds.minX + clearance ||
    point.x > srj.bounds.maxX - clearance ||
    point.y < srj.bounds.minY + clearance ||
    point.y > srj.bounds.maxY - clearance
  ) {
    return false
  }
  const outline = srj.outline
  if (!outline?.length) return true
  if (!isPointInsidePolygon(point, outline)) return false

  return outline.every(
    (outlinePoint, index) =>
      pointToSegmentDistance(
        point,
        outlinePoint,
        outline[(index + 1) % outline.length]!,
      ) >= clearance,
  )
}

/**
 * Finds sparse, obstacle-clear places where the path graph can represent a via.
 * A site is placed beside each distinct terminal so same-layer point pairs can
 * leave and re-enter their terminal layer when a local corridor is occupied.
 */
export const getTargetLayerTransitionPoints = ({
  srj,
  viaDiameter,
  obstacleMargin,
}: {
  srj: SimpleRouteJson
  viaDiameter: number
  obstacleMargin: number
}): LayerTransitionPoint[] => {
  const viaClearance = viaDiameter / 2 + obstacleMargin
  const boardClearance = viaDiameter / 2 + (srj.minBoardEdgeClearance ?? 0)
  const transitionPointsByKey = new Map<string, LayerTransitionPoint>()

  for (const connection of srj.connections) {
    if (connection.pointsToConnect.length !== 2) continue
    const [start, end] = connection.pointsToConnect
    if (
      !start ||
      !end ||
      !isSingleLayerConnectionPoint(start) ||
      !isSingleLayerConnectionPoint(end)
    ) {
      continue
    }

    for (const [terminal, otherTerminal] of [
      [start, end],
      [end, start],
    ] as const) {
      const terminalObstacle = getTerminalObstacle({
        point: terminal,
        connection,
        obstacles: srj.obstacles,
      })
      const halfWidth = terminalObstacle?.width ? terminalObstacle.width / 2 : 0
      const halfHeight = terminalObstacle?.height
        ? terminalObstacle.height / 2
        : 0
      const candidates = [
        {
          x: terminal.x - halfWidth - viaClearance,
          y: terminal.y,
        },
        {
          x: terminal.x + halfWidth + viaClearance,
          y: terminal.y,
        },
        {
          x: terminal.x,
          y: terminal.y - halfHeight - viaClearance,
        },
        {
          x: terminal.x,
          y: terminal.y + halfHeight + viaClearance,
        },
      ].sort(
        (a, b) =>
          Math.hypot(a.x - otherTerminal.x, a.y - otherTerminal.y) -
          Math.hypot(b.x - otherTerminal.x, b.y - otherTerminal.y),
      )

      const candidate = candidates.find((candidate) => {
        if (
          !pointHasBoardClearance({
            point: candidate,
            srj,
            clearance: boardClearance,
          })
        ) {
          return false
        }
        return srj.obstacles.every(
          (obstacle) =>
            obstacleMatchesConnection(obstacle, connection) ||
            pointToBoxDistance(candidate, obstacle) >= viaClearance,
        )
      })
      if (candidate) {
        const transitionPoint = {
          ...candidate,
          connectionName: connection.name,
        }
        transitionPointsByKey.set(pointKey(transitionPoint), transitionPoint)
      }
    }
  }

  return [...transitionPointsByKey.values()]
}
