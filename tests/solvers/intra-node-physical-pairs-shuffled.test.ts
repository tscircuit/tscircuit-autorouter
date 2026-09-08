import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { createIntraNodePhysicalPairProblem } from "../fixtures/intraNodePhysicalPairs"

test("physical pair scheduling shuffles complete pairs without reconstructing a cross-layer star", (): void => {
  for (const seed of [1, 2, 3]) {
    const { node, pairs, params } = createIntraNodePhysicalPairProblem()
    node.portPoints.reverse()
    const before = structuredClone(node)
    const solver = new IntraNodeRouteSolver({
      ...params,
      hyperParameters: { SHUFFLE_SEED: seed },
    })
    expect(solver.totalConnections).toBe(2)
    const scheduledPairs = solver.unsolvedConnections.map(
      (task): string => {
        expect(task.connectionName).toBe("paired-net")
        expect(task.rootConnectionName).toBe("paired-root")
        expect(task.points).toHaveLength(2)
        expect(task.points[0]!.z).toBe(task.points[1]!.z)
        return task.points
          .map((point): string => `${point.x},${point.y},${point.z}`)
          .sort()
          .join("|")
      },
    )
    const declaredPairs = pairs.map((pair): string =>
      pair
        .map((point): string => `${point.x},${point.y},${point.z}`)
        .sort()
        .join("|"),
    )
    expect(scheduledPairs.sort()).toEqual(declaredPairs.sort())
    if (seed === 1) {
      expect(solver.unsolvedConnections[0]!.points).toEqual([
        pairs[1]![1],
        pairs[1]![0],
      ])
      expect(solver.unsolvedConnections[1]!.points).toEqual(pairs[0])
    }
    expect(node).toEqual(before)
  }
})
