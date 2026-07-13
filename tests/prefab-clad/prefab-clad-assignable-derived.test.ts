import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/prefab-clad/prefab-clad-assignable-derived.srj.json"

test("prefab-clad assignable pairs are derived from connectedTo", () => {
  const srj = srjJson as SimpleRouteJson
  const assignableObstacles = srj.obstacles.filter(
    (obstacle) => obstacle.netIsAssignable === true,
  )
  const obstaclesByPrefabConnection = new Map<string, Obstacle[]>()

  expect(srj.connections).toHaveLength(17)
  expect(assignableObstacles).toHaveLength(80)
  for (const obstacle of assignableObstacles) {
    expect(obstacle.offBoardConnectsTo).toBeUndefined()
    const prefabConnectionIds = obstacle.connectedTo.filter((connectionId) =>
      connectionId.startsWith("connection_"),
    )
    expect(prefabConnectionIds).toHaveLength(1)
    const prefabConnectionId = prefabConnectionIds[0]!
    const pairedObstacles =
      obstaclesByPrefabConnection.get(prefabConnectionId) ?? []
    pairedObstacles.push(obstacle)
    obstaclesByPrefabConnection.set(prefabConnectionId, pairedObstacles)
  }

  expect(obstaclesByPrefabConnection.size).toBe(40)
  for (const pairedObstacles of obstaclesByPrefabConnection.values()) {
    expect(pairedObstacles).toHaveLength(2)
  }

  const pipeline = new AssignableAutoroutingPipeline2(srj, {
    cacheProvider: null,
    effort: 1,
  })
  pipeline.solveUntilPhase("portPointPathingSolver")

  expect(pipeline.failed).toBe(false)
  expect(pipeline.relateNodesToOffBoardConnections?.nodesInNet.size).toBe(40)
}, 20_000)
