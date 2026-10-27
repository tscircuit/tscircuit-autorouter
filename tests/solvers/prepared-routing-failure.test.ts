import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/prepared/PreparedPortPointRoutingSolver"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

test("preparation errors propagate without routing mutations and concurrent solves are rejected", async (): Promise<void> => {
  const input = createPreparedRoutingFixture()
  const solver = new PreparedPortPointRoutingSolver(input.topology, input.problem, input.options)
  const rejections: Array<(error: Error) => void> = []
  const pending = solver.solveAsync({executeAsync: () => new Promise((_resolve, reject): void => { rejections.push(reject) })}).catch((error: unknown): unknown => error)
  await expect(solver.solveAsync()).rejects.toThrow("already running")
  for (const reject of rejections) reject(new Error("worker unavailable"))
  expect(String(await pending)).toContain("worker unavailable")
  expect(solver.failed).toBe(true)
  expect(solver.iterations).toBe(0)
  expect(solver.state.regionSegments.every(segments => segments.length === 0)).toBe(true)
})
