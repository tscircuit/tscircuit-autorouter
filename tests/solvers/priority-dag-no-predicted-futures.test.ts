import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("production DAG omits every predicted future while the explicit legacy control retains its old context", () => detailedPriority(() => {
  const params = priorityParams()
  const control = new PriorityDagIntraNodeSolver(params)
  const variant = new PriorityDagIntraNodeSolver({ ...params, predictFutureConnections: false })
  const tasks = Reflect.get(variant, "tasks")
  const state = { ancestors: tasks.map(() => new Set<number>()), witnesses: tasks.map(() => undefined) }
  expect(control.predictFutureConnections).toBe(true)
  expect(variant.predictFutureConnections).toBe(false)
  expect(Reflect.get(control, "getOptions").call(control, 0, state).futureConnections).toHaveLength(2)
  for (let task = 0; task < tasks.length; task++) {
    const opts = Reflect.get(variant, "getOptions").call(variant, task, state)
    expect(opts.futureConnections).toEqual([])
    expect(opts.A).toBe(tasks[task].points[0])
    expect(opts.B).toBe(tasks[task].points[1])
  }
  const portfolio = new PortfolioSingleIntraNodeSolver({ ...params, priorityDagSearch: true })
  const families = portfolio.getCombinationDefs().flatMap((names) => portfolio.getHyperParameterCombinations(
    portfolio.getHyperParameterDefs().filter((d) => names.includes(d.name)))).filter((hp) => hp.PRIORITY_DAG_FAMILY_SIZE)
  const dag = families.map((hp) => portfolio.generateSolver(hp) as PriorityDagIntraNodeSolver)
  expect(dag).toHaveLength(8)
  expect(dag.every((s) => !s.predictFutureConnections)).toBe(true)
  expect(variant.MAX_ITERATIONS).toBe(control.MAX_ITERATIONS)
}))
