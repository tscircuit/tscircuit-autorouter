import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import { convertSrjToGraphicsObject } from "lib"
import srjJson from "../../fixtures/prefab-clad/prefab-clad01.srj.json"
import type { Obstacle, SimpleRouteJson } from "lib/types"

test("prefab-clad01 preserves paired-hole metadata and snapshots routed output", () => {
  const srj = srjJson as SimpleRouteJson
  const assignableObstacles = srj.obstacles.filter(
    (obstacle) => obstacle.netIsAssignable === true,
  )
  const obstaclesByPrefabConnection = new Map<string, Obstacle[]>()

  expect(assignableObstacles).toHaveLength(80)
  for (const obstacle of assignableObstacles) {
    const prefabConnectionIds = obstacle.connectedTo.filter((connectionId) =>
      connectionId.startsWith("connection_"),
    )
    expect(obstacle.obstacleId?.startsWith("obstacle_hole_")).toBe(true)
    expect(obstacle.layers).toEqual(["top"])
    expect(prefabConnectionIds).toHaveLength(1)
    expect(obstacle.offBoardConnectsTo).toBeUndefined()

    const prefabConnectionId = prefabConnectionIds[0]
    const pairedObstacles =
      obstaclesByPrefabConnection.get(prefabConnectionId) ?? []
    pairedObstacles.push(obstacle)
    obstaclesByPrefabConnection.set(prefabConnectionId, pairedObstacles)
  }

  expect(obstaclesByPrefabConnection.size).toBe(40)
  for (const pairedObstacles of obstaclesByPrefabConnection.values()) {
    expect(pairedObstacles).toHaveLength(2)
    expect(pairedObstacles[0].obstacleId).not.toBe(
      pairedObstacles[1].obstacleId,
    )
  }

  const preassignedCladEndpoints = srj.connections.flatMap((connection) =>
    connection.pointsToConnect.filter((point) =>
      point.pointId?.startsWith("pcb_port_hole_"),
    ),
  )
  expect(preassignedCladEndpoints).toHaveLength(0)

  const solver = new AssignableAutoroutingPipeline2(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    getSvgFromGraphicsObject(
      convertSrjToGraphicsObject(solver.getOutputSimpleRouteJson()),
      { backgroundColor: "white" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
