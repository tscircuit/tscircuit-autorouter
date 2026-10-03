import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("portfolio candidates preserve standalone routes and own their mutable connection state", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "shared-node-topology",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", rootConnectionName: "netA", x: -1, y: -0.5, z: 0 },
      { connectionName: "A", x: -1 + 1e-8, y: -0.5, z: 0 },
      { connectionName: "A", x: 1, y: -0.5, z: 0 },
      { connectionName: "A", x: 1, y: -0.25, z: 0 },
      { connectionName: "B", rootConnectionName: "netB", x: -1, y: 0.5, z: 1 },
      { connectionName: "B", x: 1, y: 0.5, z: 1 },
    ],
  }
  const originalNode = structuredClone(node)
  const params = {
    nodeWithPortPoints: node,
    connMap: new ConnectivityMap({ netA: ["A"], netB: ["B"] }),
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
  }
  const portfolio = new PortfolioSingleIntraNodeSolver(params)
  for (const seed of [0, 1, 2, 3, 4, 5, 100]) {
    const hyperParameters = { SHUFFLE_SEED: seed }
    const standalone = new CachedIntraNodeRouteSolver({
      ...params,
      hyperParameters,
      cacheProvider: null,
    })
    const candidate = portfolio.generateSolver(
      hyperParameters,
    ) as CachedIntraNodeRouteSolver
    candidate.cacheProvider = null
    expect(candidate.unsolvedConnections).toEqual(standalone.unsolvedConnections)
    expect(candidate.minDistBetweenEnteringPoints).toBeCloseTo(1e-8, 12)
    expect(candidate.computeCacheKeyAndTransform().cacheKey).toBe(
      standalone.computeCacheKeyAndTransform().cacheKey,
    )
    standalone.solve()
    candidate.solve()
    expect(candidate.solved).toBe(true)
    expect(candidate.solvedRoutes).toHaveLength(3)
    expect(candidate.solvedRoutes).toEqual(standalone.solvedRoutes)
  }

  const first = portfolio.generateSolver({
    SHUFFLE_SEED: 0,
  }) as CachedIntraNodeRouteSolver
  const second = portfolio.generateSolver({
    SHUFFLE_SEED: 0,
  }) as CachedIntraNodeRouteSolver
  const secondConnections = structuredClone(second.unsolvedConnections)
  const firstInitialConnections = structuredClone(
    first.initialUnsolvedConnections,
  )
  first.unsolvedConnections[0]!.points[0]!.x = 123
  first.originalConnectionPointsByName.get("B")![0]!.y = 456
  first.rootConnectionNameByConnectionName.set("A", "changedNet")
  first.unsolvedConnections.pop()
  expect(second.unsolvedConnections).toEqual(secondConnections)
  expect(second.originalConnectionPointsByName.get("B")![0]!.y).toBe(0.5)
  expect(second.rootConnectionNameByConnectionName.get("A")).toBe("netA")
  expect(first.initialUnsolvedConnections).toEqual(firstInitialConnections)
  expect(node).toEqual(originalNode)
})
