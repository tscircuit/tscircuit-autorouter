import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { doesBoundsContainPoint } from "lib/solvers/TopologyMergingSolver/topology-merging-regions"
import type { PreparedTopologyMergingNode } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import { TOPOLOGY_MERGING_EPSILON } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import { createTopologyMergingTestNode } from "tests/fixtures/topology-merging-test-utils"

test("indexes mesh coverage with the same tolerance and source order as a full scan", (): void => {
  const solver = new TopologyMergingSolver({
    layerCount: 4,
    nodeGroups: [0, 1].map((groupIndex) => ({
      groupId: `group-${groupIndex}`,
      isComponent: groupIndex === 1,
      nodes: Array.from({ length: 30 }, (_, index) => {
        const x = (index % 6) + groupIndex * 0.35
        const y = Math.floor(index / 6) + groupIndex * 0.2
        return createTopologyMergingTestNode({
          id: `node-${29 - index}`,
          bounds: { minX: x, maxX: x + 1, minY: y, maxY: y + 1 },
          availableZ: index % 2 === 0 ? [0, 1] : [2, 3],
        })
      }),
    })),
  })
  const original = structuredClone(solver.inputProblem)
  const preparedNodes = solver["preparedNodes"]
  for (const { bounds } of preparedNodes) {
    for (const offset of [-1.1, -1, 0, 1, 1.1]) {
      const point = {
        x: bounds.minX + offset * TOPOLOGY_MERGING_EPSILON,
        y: bounds.maxY + offset * TOPOLOGY_MERGING_EPSILON,
      }
      const actual = solver["getNodesWithinBounds"]({
        minX: point.x,
        maxX: point.x,
        minY: point.y,
        maxY: point.y,
      })
      expect(actual).toEqual(
        preparedNodes.filter(({ bounds }) =>
          doesBoundsContainPoint(bounds, point),
        ),
      )
      expect(
        solver["getNodesWithinBounds"]({
          minX: point.x,
          maxX: point.x,
          minY: Number.NEGATIVE_INFINITY,
          maxY: Number.POSITIVE_INFINITY,
        }),
      ).toEqual(
        preparedNodes.filter(
          ({ bounds }) =>
            point.x >= bounds.minX - TOPOLOGY_MERGING_EPSILON &&
            point.x <= bounds.maxX + TOPOLOGY_MERGING_EPSILON,
        ),
      )
    }
  }

  const scanSolver = new TopologyMergingSolver(structuredClone(original))
  scanSolver["getNodesWithinBounds"] = (
    bounds,
  ): PreparedTopologyMergingNode[] =>
    scanSolver["preparedNodes"].filter((preparedNode) =>
      bounds.minY === Number.NEGATIVE_INFINITY
        ? bounds.minX >= preparedNode.bounds.minX - TOPOLOGY_MERGING_EPSILON &&
          bounds.minX <= preparedNode.bounds.maxX + TOPOLOGY_MERGING_EPSILON
        : doesBoundsContainPoint(preparedNode.bounds, {
            x: bounds.minX,
            y: bounds.minY,
          }),
    )
  solver.solve()
  scanSolver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(JSON.stringify(solver.getOutput())).toBe(
    JSON.stringify(scanSolver.getOutput()),
  )
  expect(solver.stats).toEqual(scanSolver.stats)
  expect(solver.inputProblem).toEqual(original)
  expect(solver["nodeIndex"].all()).toHaveLength(0)
})
