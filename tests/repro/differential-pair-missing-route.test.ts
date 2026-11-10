import { expect, test } from "bun:test"
import { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("one missing hop or both missing lanes fail instead of reporting zero skew", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  const complete: HighDensityRoute[] = srj.connections.map(
    (connection): HighDensityRoute => ({
      connectionName: connection.name,
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
  for (const hdRoutes of [
    complete.filter((route): boolean => route.connectionName !== "P:1"),
    [],
  ]) {
    const solver = new LengthMatchingPostProcessingSolver({
      ...srj,
      hdRoutes,
      differentialPairs: srj.differentialPairs!,
      buses: [],
      obstacleMargin: 0.1,
    })
    expect(() => solver.solve()).toThrow("one complete stitched route")
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
  }
})
