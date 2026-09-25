import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("high-density caches distinguish PCB terminal identity from coincident geometry", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    portPoints: [
      { x: 0, y: 0, z: 0, connectionName: "net", portPointId: "a" },
      { x: 0, y: 0, z: 0, connectionName: "net", portPointId: "b" },
    ],
  }
  for (const Solver of [
    CachedIntraNodeRouteSolver,
    CachedPortfolioSingleIntraNodeSolver,
  ]) {
    const keys = [undefined, "pcb_a", "pcb_other"].map((pcbPortId) => {
      const solver = new Solver({
        nodeWithPortPoints: {
          ...node,
          portPoints: node.portPoints.map((point, index) => ({
            ...point,
            pcb_port_id:
              pcbPortId === undefined ? undefined : `${pcbPortId}_${index}`,
          })),
        },
      })
      return solver.computeCacheKeyAndTransform().cacheKey
    })
    expect(new Set(keys).size).toBe(3)
  }
})
