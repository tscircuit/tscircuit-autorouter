import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("native6/20 permutation families collapse to real DAG candidates within original summed allocation", () => {
  const params = priorityParams()
  const native = new PortfolioSingleIntraNodeSolver({ ...params, priorityDagSearch: false })
  const candidate = new PortfolioSingleIntraNodeSolver({ ...params, priorityDagSearch: true })
  const all = (s: PortfolioSingleIntraNodeSolver): Array<Record<string, number>> => s.getCombinationDefs().flatMap((names) =>
    s.getHyperParameterCombinations(s.getHyperParameterDefs().filter((d) => names.includes(d.name))))
  const original = all(native), replacement = all(candidate)
  const families = replacement.filter((hp) => hp.PRIORITY_DAG_FAMILY_SIZE)
  expect(families).toHaveLength(8)
  expect(families.reduce((sum, hp) => sum + hp.PRIORITY_DAG_FAMILY_SIZE, 0)).toBe(62)
  expect(original.length - replacement.length).toBe(54)
  const nativeUnit = Math.floor(new IntraNodeRouteSolver(params).MAX_ITERATIONS) + 1
  let total = 0
  for (const hp of families) {
    const solver = candidate.generateSolver(hp)
    expect(solver).toBeInstanceOf(PriorityDagIntraNodeSolver)
    expect(solver.MAX_ITERATIONS + 1).toBe(nativeUnit * hp.PRIORITY_DAG_FAMILY_SIZE)
    total += solver.MAX_ITERATIONS + 1
  }
  expect(total).toBe(nativeUnit * 62)
  const multipoint = structuredClone(params.nodeWithPortPoints)
  multipoint.portPoints[1] = { ...multipoint.portPoints[0] }
  const ineligible = new PortfolioSingleIntraNodeSolver({ ...params, nodeWithPortPoints: multipoint, priorityDagSearch: true })
  expect(all(ineligible).some((hp) => hp.PRIORITY_DAG_FAMILY_SIZE)).toBe(false)
})
