import {
  isPointInsidePolygon,
  pointToBoxDistance,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { ConnectionPoint, Obstacle, SimpleRouteJson } from "lib/types"
import { isSingleLayerConnectionPoint } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export type LayerTransitionPoint = {
  x: number
  y: number
  connectionName: string
  availableZ?: number[]
}

const pointIsInsideObstacle = (
  point: { x: number; y: number },
  obstacle: Obstacle,
): boolean =>
  Math.abs(point.x - obstacle.center.x) <= obstacle.width / 2 &&
  Math.abs(point.y - obstacle.center.y) <= obstacle.height / 2

const obstacleMatchesConnection = (
  obstacle: Obstacle,
  connectionIds: ReadonlySet<string>,
): boolean => {
  return obstacle.connectedTo.some((id) => connectionIds.has(id))
}

const getTerminalObstacle = ({
  point,
  connectionIds,
  obstacles,
}: {
  point: ConnectionPoint
  connectionIds: ReadonlySet<string>
  obstacles: Obstacle[]
}): Obstacle | undefined => {
  if (!isSingleLayerConnectionPoint(point)) return undefined
  return obstacles
    .filter(
      (obstacle) =>
        obstacle.layers.includes(point.layer) &&
        pointIsInsideObstacle(point, obstacle) &&
        obstacleMatchesConnection(obstacle, connectionIds),
    )
    .sort((a, b) => a.width * a.height - b.width * b.height)[0]
}

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
 * A site is placed at or beside each distinct terminal so same-layer point pairs can
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
  const visitedTerminals = new Set<string>()

  for (const connection of srj.connections) {
    if (connection.pointsToConnect.length !== 2) continue
    const [start, end] = connection.pointsToConnect
    if (!start || !end) continue
    const connectionIds = new Set([
      connection.name,
      ...(connection.__rootConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((point) =>
        [point.pointId, point.pcb_port_id].filter(
          (id): id is string => id !== undefined,
        ),
      ),
    ])

    for (const [terminal, otherTerminal] of [
      [start, end],
      [end, start],
    ] as const) {
      if (!isSingleLayerConnectionPoint(terminal)) continue
      const terminalKey = terminal.pcb_port_id ?? terminal.pointId
      if (terminalKey && visitedTerminals.has(terminalKey)) continue
      if (terminalKey) visitedTerminals.add(terminalKey)
      const terminalObstacle = getTerminalObstacle({
        point: terminal,
        connectionIds,
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

      if (srj.allowViaInPad && terminalObstacle) {
        candidates.unshift({ x: terminal.x, y: terminal.y })
      }

      for (const candidate of candidates) {
        if (
          !pointHasBoardClearance({
            point: candidate,
            srj,
            clearance: boardClearance,
          })
        ) {
          continue
        }
        const clearZ = Array.from({ length: srj.layerCount }, () => true)
        for (const obstacle of srj.obstacles) {
          if (
            obstacleMatchesConnection(obstacle, connectionIds) ||
            pointToBoxDistance(candidate, obstacle) >= viaClearance
          ) {
            continue
          }
          for (const layer of obstacle.layers) {
            clearZ[mapLayerNameToZ(layer, srj.layerCount)] = false
          }
        }
        const terminalZ = mapLayerNameToZ(terminal.layer, srj.layerCount)
        if (!clearZ[terminalZ]) continue
        let firstZ = terminalZ
        let lastZ = terminalZ
        if (srj.allowBlindAndBuriedVias) {
          while (firstZ > 0 && clearZ[firstZ - 1]) firstZ--
          while (lastZ + 1 < srj.layerCount && clearZ[lastZ + 1]) lastZ++
        } else {
          if (clearZ.some((clear) => !clear)) continue
          firstZ = 0
          lastZ = srj.layerCount - 1
        }
        if (firstZ === lastZ) continue
        const availableZ = Array.from(
          { length: lastZ - firstZ + 1 },
          (_, index) => firstZ + index,
        )
        const transitionPoint: LayerTransitionPoint = {
          ...candidate,
          connectionName: connection.name,
          availableZ,
        }
        const key = `${terminalKey ?? connection.name}:${candidate.x.toFixed(6)},${candidate.y.toFixed(6)}:${availableZ.join(",")}`
        transitionPointsByKey.set(key, transitionPoint)
        break
      }
    }
  }

  return [...transitionPointsByKey.values()]
}
