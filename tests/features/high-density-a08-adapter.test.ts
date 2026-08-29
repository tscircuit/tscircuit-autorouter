import { expect, test } from "bun:test"
import { HighDensitySolverA08IntraNodeAdapter } from "lib/solvers/HighDensitySolver/high-density-solver-a08-adapter"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002LargeNode from "../fixtures/srj18-sample002-large-node.json"

test("A08 preserves explicit SRJ18 terminal identities and rejects ambiguous inputs", () => {
  const nodeWithPortPoints = sample002LargeNode as NodeWithPortPoints
  const params = {
    nodeWithPortPoints,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    clearance: 0.1,
    obstacles: [],
    effort: 1,
    minimumPairCount: 8,
  }

  expect(HighDensitySolverA08IntraNodeAdapter.isApplicable(params)).toBe(true)

  const solver = new HighDensitySolverA08IntraNodeAdapter(params)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toHaveLength(19)

  const routesByConnectionName = new Map(
    solver.getOutput().map((route) => [route.connectionName, route]),
  )
  for (const [start, end] of nodeWithPortPoints.portPointsInPairs!) {
    const route = routesByConnectionName.get(start.connectionName)!
    const firstPoint = route.route[0] as (typeof route.route)[number] & {
      portPointId?: string
    }
    const lastPoint = route.route.at(-1) as (typeof route.route)[number] & {
      portPointId?: string
    }

    expect(route.rootConnectionName).toBe(start.rootConnectionName)
    expect(route.regionId).toBe(nodeWithPortPoints.capacityMeshNodeId)
    expect(firstPoint.portPointId).toBe(start.portPointId)
    expect(lastPoint.portPointId).toBe(end.portPointId)
    expect([firstPoint.x, firstPoint.y, firstPoint.z]).toEqual([
      start.x,
      start.y,
      start.z,
    ])
    expect([lastPoint.x, lastPoint.y, lastPoint.z]).toEqual([
      end.x,
      end.y,
      end.z,
    ])
  }

  const ambiguousNode = structuredClone(nodeWithPortPoints)
  ambiguousNode.portPoints[1]!.portPointId =
    ambiguousNode.portPoints[0]!.portPointId
  expect(
    HighDensitySolverA08IntraNodeAdapter.isApplicable({
      ...params,
      nodeWithPortPoints: ambiguousNode,
    }),
  ).toBe(false)

  const rootlessMstNode = structuredClone(nodeWithPortPoints)
  for (const portPoint of rootlessMstNode.portPoints) {
    delete portPoint.rootConnectionName
  }
  for (const pair of rootlessMstNode.portPointsInPairs!) {
    delete pair[0].rootConnectionName
    delete pair[1].rootConnectionName
  }
  expect(
    HighDensitySolverA08IntraNodeAdapter.isApplicable({
      ...params,
      nodeWithPortPoints: rootlessMstNode,
    }),
  ).toBe(false)

  const mixedRootMstNode = structuredClone(nodeWithPortPoints)
  for (const portPoint of mixedRootMstNode.portPoints) {
    delete portPoint.rootConnectionName
  }
  expect(
    HighDensitySolverA08IntraNodeAdapter.isApplicable({
      ...params,
      nodeWithPortPoints: mixedRootMstNode,
    }),
  ).toBe(false)
})
