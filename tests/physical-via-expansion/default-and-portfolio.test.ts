import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("direct APIs retain per-layer checks and portfolio honors overrides", () => {
  const single = new SingleHighDensityRouteSolver({
    connectionName: "route",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
    A: { x: 0.2, y: 0.2, z: 0 },
    B: { x: 1.8, y: 1.8, z: 5 },
    availableZ: [0, 1, 2, 3, 4, 5],
    layerCount: 6,
  })
  let viaChecks = 0
  single.isNodeTooCloseToObstacle = (node, _margin, isVia) => {
    if (!isVia) return false
    viaChecks++
    return node.z !== 3
  }
  const neighbors = single.getNeighbors({
    x: 1,
    y: 1,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  })
  expect(single.viaExpansion).toBe("per-layer")
  expect(viaChecks).toBe(5)
  expect(
    neighbors.filter((node) => node.z !== 0).map((node) => node.z),
  ).toEqual([3])

  const opts = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      portPoints: [],
    },
  }
  expect(new IntraNodeRouteSolver(opts).viaExpansion).toBe("per-layer")
  const selected = new PortfolioSingleIntraNodeSolver(opts).generateSolver({})
  expect((selected as IntraNodeRouteSolver).viaExpansion).toBe("physical")
  const overridden = new PortfolioSingleIntraNodeSolver({
    ...opts,
    viaExpansion: "per-layer",
  }).generateSolver({})
  expect((overridden as IntraNodeRouteSolver).viaExpansion).toBe("per-layer")
})
