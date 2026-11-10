import { expect, test } from "bun:test"
import { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("lane lengths exclude a same-root tap while preserving all real roots", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const hdRoutes: HighDensityRoute[] = srj.connections.map(
    (connection): HighDensityRoute => ({
      connectionName: connection.name,
      rootConnectionName: connMap.getNetConnectedToId(connection.name)!,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: connection.pointsToConnect.map(
        (point): HighDensityRoute["route"][number] => ({
          x: point.x,
          y: point.y,
          z: 0,
        }),
      ),
    }),
  )
  expect(hdRoutes[0]!.rootConnectionName).toBe(hdRoutes[4]!.rootConnectionName)
  const solver = new LengthMatchingPostProcessingSolver({
    ...srj,
    hdRoutes,
    differentialPairs: srj.differentialPairs!,
    buses: [],
    obstacleMargin: 0.1,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutput().hdRoutes).toEqual(hdRoutes)
})
