import { expect, test } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { loadScenarioBySampleNumber } from "scripts/benchmark/scenarios"

test("PMP22650 point-pair trees span every terminal", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 24)
  const solver = new NetToPointPairsSolver2_OffBoardConnection(
    scenario,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(scenario),
  )
  solver.solve()

  const disconnectedNets: Array<{
    name: string
    pointCount: number
    componentCount: number
  }> = []
  for (const connection of scenario.connections) {
    const pointIds = connection.pointsToConnect.map((point) => point.pointId!)
    const parentByPointId = new Map(
      pointIds.map((pointId) => [pointId, pointId]),
    )
    const findRoot = (pointId: string): string => {
      const parent = parentByPointId.get(pointId)!
      if (parent === pointId) return pointId
      const root = findRoot(parent)
      parentByPointId.set(pointId, root)
      return root
    }
    const joinPointIds = (connectedPointIds: string[]): void => {
      const firstPointId = connectedPointIds.find((pointId) =>
        parentByPointId.has(pointId),
      )
      if (!firstPointId) return
      const firstRoot = findRoot(firstPointId)
      for (const pointId of connectedPointIds) {
        if (parentByPointId.has(pointId)) {
          parentByPointId.set(findRoot(pointId), firstRoot)
        }
      }
    }

    for (const pointIds of connection.externallyConnectedPointIds ?? []) {
      joinPointIds(pointIds)
    }
    for (const pointPair of solver.newConnections) {
      if (!pointPair.__rootConnectionNames?.includes(connection.name)) continue
      joinPointIds(pointPair.pointsToConnect.map((point) => point.pointId!))
    }

    const componentCount = new Set(pointIds.map(findRoot)).size
    if (componentCount > 1) {
      disconnectedNets.push({
        name: connection.name,
        pointCount: pointIds.length,
        componentCount,
      })
    }
  }

  expect(
    scenario.connections.flatMap(
      (connection) => connection.externallyConnectedPointIds ?? [],
    ),
  ).toEqual([])
  expect(solver.newConnections).toHaveLength(1934)
  expect(disconnectedNets).toEqual([])
})
