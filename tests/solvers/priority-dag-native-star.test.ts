import { expect, test } from "bun:test"
import { decomposePriorityTasks } from "lib/solvers/HighDensitySolver/decomposePriorityTasks"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("multi-terminal tasks match the native star queue, six-decimal dedupe, identities and original group budget", () => {
  const params = priorityParams()
  params.nodeWithPortPoints.portPoints.push(
    { ...params.nodeWithPortPoints.portPoints[0], x: -1, y: 1 },
    { ...params.nodeWithPortPoints.portPoints[0], x: 1, y: 1 },
  )
  const native = new IntraNodeRouteSolver(params)
  const actual = decomposePriorityTasks(native.unsolvedConnections, () => {})!
  const expected = []
  while (native.unsolvedConnections.length) {
    const task = native.unsolvedConnections.pop()!
    if (
      task.points.length > 2 &&
      Reflect.get(native, "queueExtraBranchesForMultiPointConnection").call(
        native,
        task,
      )
    )
      continue
    expected.push(task)
  }
  expect(actual).toEqual(expected)
  expect(actual).toHaveLength(5)
  expect(actual.filter((t) => t.connectionName === "a")).toHaveLength(3)
  expect(new Set(actual.map((t) => t.connectionName))).toEqual(
    new Set(["a", "b", "c"]),
  )
  const solver = new PriorityDagIntraNodeSolver(params)
  expect(solver.MAX_ITERATIONS + 1).toBe(
    (Math.floor(native.MAX_ITERATIONS) + 1) * params.priorityFamilySize,
  )
  const a = {
    connectionName: "wire",
    rootConnectionName: "root",
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 2, z: 0 },
      { x: 2 + 4e-8, y: 2, z: 0 },
    ],
  }
  expect(decomposePriorityTasks([a], () => {})).toEqual([
    { ...a, points: [a.points[0], a.points[2]] },
    { ...a, points: [a.points[0], a.points[1]] },
  ])
  expect(
    decomposePriorityTasks(
      [
        {
          ...a,
          points: [
            { x: 1, y: 1, z: 0 },
            { x: 1, y: 1, z: 1 },
          ],
        },
      ],
      () => {},
    ),
  ).toBeNull()
})
