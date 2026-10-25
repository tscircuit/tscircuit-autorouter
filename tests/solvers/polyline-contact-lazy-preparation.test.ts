import { expect, test } from "bun:test"
import { MultiHeadPolylineContactSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolylineContactSolver"
import { createPolylineContactFixture } from "../fixtures/createPolylineContactFixture"

test("unscheduled contact candidates do no board-model work and selected candidates execute coupled QPs", (): void => {
  const { context, candidate } = createPolylineContactFixture()
  let connectivityReads = 0
  const solver = new MultiHeadPolylineContactSolver({
    ...context,
    obstacles: [{ type: "rect", center: { x: 10, y: 10 }, width: 0.2, height: 0.2, layers: ["top"],
      get connectedTo(): string[] { connectivityReads++; return [] } }],
  })
  expect(connectivityReads).toBe(0)
  expect(Number(solver.stats.contactWorkUnits ?? 0)).toBe(0)
  expect(Number(solver.stats.contactModelPreparations ?? 0)).toBe(0)
  solver.phase = "solving"
  solver.candidates = [candidate]
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  expect(connectivityReads).toBeGreaterThan(0)
  expect(solver.stats.contactModelPreparations).toBe(1)
  expect(solver.stats.contactQpRowUpdates).toBeGreaterThan(0)
  expect(solver.stats.contactAcceptedSteps).toBeGreaterThan(0)
})
