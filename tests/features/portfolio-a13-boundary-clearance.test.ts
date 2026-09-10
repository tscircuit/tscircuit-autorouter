import { expect, test } from "bun:test"
import { findRouteGeometryViolations } from "@tscircuit/high-density-a01"
import { HighDensitySolverA13WithBoundaryClearance } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithBoundaryClearance"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("A13 reserves boundary clearance and restores exact terminals", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "boundary-clearance",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", x: -2, y: -2, z: 0 },
      { connectionName: "a", x: 2, y: -2, z: 0 },
      { connectionName: "b", x: -2, y: 2, z: 1 },
      { connectionName: "b", x: 2, y: 2, z: 1 },
    ],
  }
  const solver = new HighDensitySolverA13WithBoundaryClearance({
    nodeWithPortPoints: node,
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaDiameter: 0.3,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  const routes = solver.getOutput()
  expect(routes).toHaveLength(2)
  for (const route of routes) {
    const terminals = node.portPoints.filter(
      (point) => point.connectionName === route.connectionName,
    )
    expect(route.route[0]).toEqual(terminals[0]!)
    expect(route.route.at(-1)).toEqual(terminals[1]!)
    for (const point of route.route.slice(1, -1)) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(1.85)
      expect(Math.abs(point.y)).toBeLessThanOrEqual(1.85)
    }
  }
  expect(findRouteGeometryViolations(routes)).toEqual([])
  const collapsed = new HighDensitySolverA13WithBoundaryClearance({
    nodeWithPortPoints: {
      ...node,
      portPoints: [
        { connectionName: "a", x: -2, y: -2, z: 0 },
        { connectionName: "a", x: -1.95, y: -2, z: 0 },
      ],
    },
    traceThickness: 0.1,
    traceMargin: 0.1,
  })
  expect(collapsed.failed).toBeTrue()
  expect(collapsed.solved).toBeFalse()
})
