import { expect, test } from "bun:test"
import { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { SimpleRouteJson } from "lib/types"

test("multigraph topology forwards obstacle clearance to the global rectdiff solve", (): void => {
  const inputSrj: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [
      {
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    connections: [],
  }
  const solver = new MultiGraphTopologyPlannerSolver({
    inputSrj,
    obstacleMargin: 0.23,
  })

  solver.step()

  expect(solver.globalTopologySolver?.inputProblem.obstacleClearance).toBe(0.23)
})
