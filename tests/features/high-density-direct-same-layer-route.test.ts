import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"

test("high-density routing bypasses the portfolio for a direct same-layer route", () => {
  const solver = new HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "direct-route-node",
        center: { x: 0, y: 0 },
        width: 10,
        height: 10,
        availableZ: [0, 1, 2, 3, 4, 5],
        portPoints: [
          { x: -5, y: 0, z: 0, connectionName: "route" },
          { x: 5, y: 0, z: 0, connectionName: "route" },
        ],
      },
    ],
    layerCount: 6,
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })

  solver.step()
  expect(solver.activeSubSolver).toBeInstanceOf(IntraNodeRouteSolver)

  solver.solve()
  expect(solver.routes).toEqual([
    {
      connectionName: "route",
      rootConnectionName: undefined,
      regionId: "direct-route-node",
      route: [
        { x: -5, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [],
    },
  ])

  const sameEdgeSolver = new HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "same-edge-node",
        center: { x: 0, y: 0 },
        width: 10,
        height: 10,
        availableZ: [0, 1, 2, 3, 4, 5],
        portPoints: [
          { x: -5, y: -1, z: 0, connectionName: "route" },
          { x: -5, y: 1, z: 0, connectionName: "route" },
        ],
      },
    ],
    layerCount: 6,
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })

  sameEdgeSolver.step()
  expect(sameEdgeSolver.activeSubSolver).toBeInstanceOf(
    GrowShrinkHighDensityIntraNodeSolver,
  )
})
