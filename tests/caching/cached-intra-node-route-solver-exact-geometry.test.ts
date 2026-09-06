import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("nearby physical inputs cannot reuse an inexact intra-node route", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_a",
    center: { x: 0, y: 0 },
    width: 2,
    height: 1,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", x: -1, y: 0, z: 0 },
      { connectionName: "A", x: 1, y: 0, z: 0 },
    ],
  }
  const createSolver = (
    nodeWithPortPoints: NodeWithPortPoints,
    overrides: {
      traceWidth?: number
      viaDiameter?: number
      obstacleMargin?: number
    } = {},
  ): CachedIntraNodeRouteSolver =>
    new CachedIntraNodeRouteSolver({
      nodeWithPortPoints,
      traceWidth: overrides.traceWidth ?? 0.15,
      viaDiameter: overrides.viaDiameter ?? 0.3,
      obstacleMargin: overrides.obstacleMargin ?? 0.15,
      hyperParameters: { SHUFFLE_SEED: 0 },
      cacheProvider: null,
    })
  const baseKey: string =
    createSolver(node).computeCacheKeyAndTransform().cacheKey
  const translatedNode: NodeWithPortPoints = {
    ...node,
    center: { x: 0.0002, y: 0 },
    portPoints: node.portPoints.map((point) => ({
      ...point,
      x: point.x + 0.0002,
    })),
  }
  const renamedNodeSolver: CachedIntraNodeRouteSolver = createSolver({
    ...node,
    capacityMeshNodeId: "cmn_b",
  })

  expect(
    [
      createSolver(translatedNode),
      createSolver({ ...node, width: 2.0002 }),
      createSolver(node, { traceWidth: 0.1502 }),
      createSolver(node, { viaDiameter: 0.3002 }),
      createSolver(node, { obstacleMargin: 0.1502 }),
    ].map((solver) => solver.computeCacheKeyAndTransform().cacheKey),
  ).not.toContain(baseKey)
  expect(renamedNodeSolver.computeCacheKeyAndTransform().cacheKey).toBe(baseKey)
  renamedNodeSolver.applyCachedSolution({
    success: true,
    solvedRoutes: [
      {
        connectionName: "A",
        regionId: "cmn_a",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: -1, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
  })
  expect(renamedNodeSolver.solvedRoutes[0]?.regionId).toBe("cmn_b")
})
