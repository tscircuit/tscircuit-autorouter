import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import {
  sample4PlanarPortOrderInputNodes,
  sample4PlanarPortOrderNodes,
} from "./fixtures/uniform-port-distribution-planar-order.fixture"

test("uniform distribution orders tied duplicate ports without a single-layer crossing", () => {
  const distributionSolver = new UniformPortDistributionSolver({
    nodeWithPortPoints: structuredClone(sample4PlanarPortOrderNodes),
    inputNodesWithPortPoints: structuredClone(sample4PlanarPortOrderInputNodes),
    obstacles: [],
    minTraceWidth: 0.1,
    traceClearance: 0.1,
  })
  distributionSolver.solve()

  const routedNode = distributionSolver
    .getOutput()
    .find((node) => node.capacityMeshNodeId === "sample4-left-node")!
  const sharedPorts = routedNode.portPoints
    .filter((point) => point.portPointId?.includes("shared-port"))
    .toSorted((a, b) => a.y - b.y)

  expect(sharedPorts.map((point) => point.rootConnectionName)).toEqual([
    "source_trace_169",
    "source_trace_175",
  ])

  const portfolioSolver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: routedNode,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 6,
    effort: 1,
  })
  portfolioSolver.solve()

  expect(portfolioSolver.solved).toBe(true)
  expect(portfolioSolver.solvedRoutes).toHaveLength(2)
})
