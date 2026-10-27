import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("connected crossing and coincident copper can produce zero-via seeds", (): void => {
  const connMap = new ConnectivityMap({ ground: ["branch-a", "alias"] })
  connMap.addConnections([["alias", "branch-b"]])
  const geometries: NodeWithPortPoints["portPoints"][] = [
    [
      { connectionName: "branch-a", x: -2, y: -2, z: 0 },
      { connectionName: "branch-a", x: 2, y: 2, z: 0 },
      { connectionName: "branch-b", x: -2, y: 2, z: 0 },
      { connectionName: "branch-b", x: 2, y: -2, z: 0 },
    ],
    [
      { connectionName: "branch-a", x: -2, y: -2, z: 0 },
      { connectionName: "branch-a", x: 2, y: -2, z: 0 },
      { connectionName: "branch-b", x: -2, y: -2, z: 0 },
      { connectionName: "branch-b", x: 2, y: -2, z: 0 },
    ],
  ]
  for (const portPoints of geometries) {
    const nodeWithPortPoints: NodeWithPortPoints = {
      capacityMeshNodeId: "connected-seed",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints,
    }
    for (const Solver of [MultiHeadPolyLineIntraNodeSolver, MultiHeadPolyLineIntraNodeSolver3]) {
      const solver = new Solver({
        nodeWithPortPoints,
        connMap,
        hyperParameters: { SEGMENTS_PER_POLYLINE: 1 },
      })
      expect(solver.minViaCount).toBe(0)
      expect(solver.failed).toBe(false)
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(solver.solvedRoutes).toHaveLength(2)
      expect(solver.solvedRoutes.flatMap((route) => route.vias)).toHaveLength(0)
      expect(solver.lastCandidate).not.toBeNull()
      expect(solver.checkIfSolved(solver.lastCandidate!)).toBe(true)
    }
  }
})
