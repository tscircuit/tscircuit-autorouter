import type { Obstacle, SimpleRouteJson } from "lib/types"

const getUniqueValues = (values: readonly string[]) => {
  const seen = new Set<string>()

  return values.filter((value) => {
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

const addRootConnectionMapping = (
  rootConnectionIndex: Map<string, string[]>,
  identifier: string | undefined,
  rootConnectionName: string,
) => {
  if (!identifier) return

  const existingRootConnectionNames = rootConnectionIndex.get(identifier)

  if (!existingRootConnectionNames) {
    rootConnectionIndex.set(identifier, [rootConnectionName])
    return
  }

  if (!existingRootConnectionNames.includes(rootConnectionName)) {
    existingRootConnectionNames.push(rootConnectionName)
  }
}

const getObstacleRootConnectionNames = (
  obstacle: Obstacle,
  rootConnectionIndex: Map<string, string[]>,
) =>
  getUniqueValues([
    ...obstacle.connectedTo.flatMap(
      (identifier) => rootConnectionIndex.get(identifier) ?? [],
    ),
    ...(obstacle.offBoardConnectsTo ?? []).flatMap(
      (identifier) => rootConnectionIndex.get(identifier) ?? [],
    ),
  ])

export const formatObstacleLabel = (
  obstacle: Obstacle,
  rootConnectionNames: readonly string[] = [],
) => {
  const rootConnectionLabel = getUniqueValues(rootConnectionNames).join(", ")

  return obstacle.layers
    .map((layer) =>
      rootConnectionLabel ? `${layer}\n${rootConnectionLabel}` : layer,
    )
    .join("\n")
}

export const createObstacleLabelFormatter = (srj: SimpleRouteJson) => {
  const rootConnectionIndex = new Map<string, string[]>()

  for (const connection of srj.connections) {
    const rootConnectionNames = connection.__rootConnectionNames ?? [
      connection.name,
    ]
    for (const rootConnectionName of rootConnectionNames) {
      addRootConnectionMapping(
        rootConnectionIndex,
        connection.name,
        rootConnectionName,
      )
      addRootConnectionMapping(
        rootConnectionIndex,
        rootConnectionName,
        rootConnectionName,
      )
      addRootConnectionMapping(
        rootConnectionIndex,
        connection.__netConnectionName,
        rootConnectionName,
      )

      for (const point of connection.pointsToConnect) {
        addRootConnectionMapping(
          rootConnectionIndex,
          point.pointId,
          rootConnectionName,
        )
        addRootConnectionMapping(
          rootConnectionIndex,
          point.pcb_port_id,
          rootConnectionName,
        )
      }
    }
  }

  return (obstacle: Obstacle) =>
    formatObstacleLabel(
      obstacle,
      getObstacleRootConnectionNames(obstacle, rootConnectionIndex),
    )
}
