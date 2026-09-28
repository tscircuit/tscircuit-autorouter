import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("overlapping unrelated terminals fail before search, while connected copper and separate layers remain eligible", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "overlapping-terminals",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1, 2, 3],
    portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "a" },
      { x: 1, y: 0, z: 0, connectionName: "a" },
      { x: -1, y: 0.05, z: 0, connectionName: "b" },
      { x: 1, y: 0.05, z: 0, connectionName: "b" },
    ],
  }
  const create = (
    nodeWithPortPoints: NodeWithPortPoints,
  ): PortfolioSingleIntraNodeSolver =>
    new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints,
      layerCount: 4,
      traceWidth: 0.1,
      rejectOverlappingTerminals: true,
    })
  const blocked = create(node)
  expect(blocked.failed).toBe(true)
  expect(blocked.iterations).toBe(0)
  expect(blocked.error).toContain("terminals overlap")
  expect(
    create({
      ...node,
      portPoints: node.portPoints.map((point) => ({
        ...point,
        rootConnectionName: "shared",
      })),
    }).failed,
  ).toBe(false)
  expect(
    create({
      ...node,
      portPoints: node.portPoints.map((point) => ({
        ...point,
        z: point.connectionName === "b" ? 1 : 0,
      })),
    }).failed,
  ).toBe(false)
})
