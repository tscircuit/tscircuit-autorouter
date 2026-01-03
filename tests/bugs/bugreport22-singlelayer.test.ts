import { expect, test } from "bun:test"
import {
  AssignableAutoroutingPipeline1Solver,
  AssignableAutoroutingPipeline2,
} from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport22-2a75ce/bugreport22-2a75ce.json" with {
  type: "json",
}
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("bugreport22 - singlelayer (subset)", () => {
  const srj = bugReport as SimpleRouteJson
  // Filter obstacle zLayers to only include layer 0 for single layer boards
  const filteredObstacles = srj.obstacles.map((obstacle) => ({
    ...obstacle,
    zLayers: obstacle.zLayers?.filter((z) => z === 0) ?? [0],
  }))
  // Use only a small subset of connections to make the test faster
  const connectionSubset = srj.connections.slice(0, 8)
  const connectionNames = new Set(connectionSubset.map((c) => c.name))
  // Only keep obstacles connected to our subset
  const relevantObstacles = filteredObstacles.filter(
    (o) =>
      !o.connectedTo ||
      o.connectedTo.length === 0 ||
      o.connectedTo.some((c) => connectionNames.has(c)),
  )

  const solver = new AssignableAutoroutingPipeline2({
    ...srj,
    obstacles: relevantObstacles,
    connections: connectionSubset,
    layerCount: 1,
  })
  solver.solve()
  if (solver.failed) {
    console.log("Solver failed:", solver.error)
    console.log("Current phase:", solver.getCurrentPhase())
    console.log("Active sub-solver error:", solver.activeSubSolver?.error)
  }

  // Check if jumpers are present in the routes
  const routes = solver._getOutputHdRoutes()
  const routesWithJumpers = routes.filter(
    (r) => r.jumpers && r.jumpers.length > 0,
  )
  console.log(
    `Found ${routesWithJumpers.length} routes with jumpers out of ${routes.length} total routes`,
  )
  for (const r of routesWithJumpers) {
    console.log(`  - ${r.connectionName}: ${r.jumpers?.length} jumper(s)`)
  }

  expect(solver.solved).toBe(true)

  // Output visualization for debugging
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
}, 120_000)
