import {
  type Bounds,
  doBoundsOverlap,
  getBoundFromCenteredRect,
} from "@tscircuit/math-utils"
import type { Obstacle, SimpleRouteConnection } from "lib/types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { GEOMETRY_EPSILON } from "./capacity-node-geometry"

export type ConnectedObstacleFragment = {
  bounds: Bounds
  zLayers: number[]
}

export type ConnectedObstacleFragmentGroup = {
  connectionNames: string[]
  fragments: ConnectedObstacleFragment[]
}

type GroupedObstacle = ConnectedObstacleFragment & {
  connectionNames: string[]
}

const getRoutableConnectionNames = (
  connections: readonly SimpleRouteConnection[],
): Set<string> => {
  const connectionNames = new Set<string>()
  for (const connection of connections) {
    connectionNames.add(connection.name)
    for (const rootConnectionName of connection.__rootConnectionNames ?? []) {
      connectionNames.add(rootConnectionName)
    }
  }
  return connectionNames
}

const getObstacleGroupKey = (
  obstacle: Obstacle & { __zLayers: number[] },
): string =>
  JSON.stringify([
    obstacle.componentId ?? null,
    obstacle.__zLayers,
    [...new Set(obstacle.connectedTo)].sort(),
  ])

const expandBounds = (bounds: Bounds): Bounds => ({
  minX: bounds.minX - GEOMETRY_EPSILON,
  maxX: bounds.maxX + GEOMETRY_EPSILON,
  minY: bounds.minY - GEOMETRY_EPSILON,
  maxY: bounds.maxY + GEOMETRY_EPSILON,
})

const splitIntoConnectedGroups = (
  obstacles: readonly GroupedObstacle[],
): GroupedObstacle[][] => {
  const unvisitedObstacleIndexes = new Set(obstacles.map((_, index) => index))
  const connectedGroups: GroupedObstacle[][] = []

  while (unvisitedObstacleIndexes.size > 0) {
    const firstIndex = unvisitedObstacleIndexes.values().next().value
    if (firstIndex === undefined) break

    const connectedIndexes = [firstIndex]
    unvisitedObstacleIndexes.delete(firstIndex)
    for (let cursor = 0; cursor < connectedIndexes.length; cursor++) {
      const obstacleIndex = connectedIndexes[cursor]!
      const obstacle = obstacles[obstacleIndex]!
      for (const candidateIndex of [...unvisitedObstacleIndexes]) {
        const candidate = obstacles[candidateIndex]!
        if (!doBoundsOverlap(expandBounds(obstacle.bounds), candidate.bounds)) {
          continue
        }
        connectedIndexes.push(candidateIndex)
        unvisitedObstacleIndexes.delete(candidateIndex)
      }
    }

    connectedGroups.push(connectedIndexes.map((index) => obstacles[index]!))
  }

  return connectedGroups
}

/** Finds copper shapes represented by multiple adjacent SRJ rectangles. */
export function getConnectedObstacleFragmentGroups({
  obstacles,
  connections,
  layerCount,
}: {
  obstacles: readonly Obstacle[]
  connections: readonly SimpleRouteConnection[]
  layerCount: number
}): ConnectedObstacleFragmentGroup[] {
  const routableConnectionNames = getRoutableConnectionNames(connections)
  const obstacleGroups = new Map<string, GroupedObstacle[]>()

  for (const obstacle of createObjectsWithZLayers(obstacles, layerCount)) {
    const connectionNames = obstacle.connectedTo.filter((connectionName) =>
      routableConnectionNames.has(connectionName),
    )
    if (connectionNames.length === 0) continue

    const groupedObstacle: GroupedObstacle = {
      bounds: getBoundFromCenteredRect(obstacle),
      connectionNames: [...new Set(connectionNames)].sort(),
      zLayers: obstacle.__zLayers,
    }
    const groupKey = getObstacleGroupKey(obstacle)
    const group = obstacleGroups.get(groupKey) ?? []
    group.push(groupedObstacle)
    obstacleGroups.set(groupKey, group)
  }

  return [...obstacleGroups.values()].flatMap((obstacleGroup) =>
    splitIntoConnectedGroups(obstacleGroup).flatMap((connectedGroup) => {
      if (connectedGroup.length < 2) return []
      return [
        {
          connectionNames: connectedGroup[0]!.connectionNames,
          fragments: connectedGroup.map(({ bounds, zLayers }) => ({
            bounds,
            zLayers,
          })),
        },
      ]
    }),
  )
}
