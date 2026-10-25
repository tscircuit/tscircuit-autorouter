import { expect, test } from "bun:test"
import type { EventTileSearchInputs } from "lib/solvers/HighDensitySolver/EventTileSearchKernel"
import { HighDensitySolverA13EventTiles } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13EventTiles"
import { denseEventOracle, emptyEventInput } from "./eventTileTestUtils"

type QueryKernel = {
  begin: (inputs: EventTileSearchInputs, start: number, goal: number, present: number) => void
  run: (steps: number, budget: number) => { status: number; expansions: number }
  copyParents: (target: Int32Array) => void
}

test("a fully dense current profile delegates before macro search, charges its scan, and publishes only native parents", (): void => {
  const solver = new HighDensitySolverA13EventTiles({
    nodeWithPortPoints: {
      capacityMeshNodeId: "event-dense-profile-policy",
      center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
      portPoints: [{ connectionName: "a", x: -1, y: 0, z: 0 }, { connectionName: "a", x: 1, y: 0, z: 1 }],
    }, layerCount: 2, obstacles: [],
  })
  solver._setup()
  const input = emptyEventInput(solver.cols, solver.rows, 2)
  const plane = solver.cols * solver.rows
  for (let state = 0; state < 2 * plane; state++) {
    const xy = state % plane
    input.history[state] = (xy % solver.cols + Math.floor(xy / solver.cols)) % 2 * 0.2
  }
  const query = Reflect.get(solver, "searchKernel") as QueryKernel
  const goal = plane - 1
  const oracle = denseEventOracle(input, solver.cols, solver.rows, 2, 0, goal,
    0.5, 1.7 / (solver.cols - 1), 1.7 / (solver.rows - 1))
  query.begin(input, 0, goal, 0.5)
  let status = 0
  let work = 0
  while (status === 0) {
    const result = query.run(37, 100_000 - work)
    status = result.status
    work += result.expansions
  }
  expect(status).toBe(1)
  expect(solver.eventKernel!.diagnostics.declinedQueries).toBe(1)
  expect(solver.eventKernel!.diagnostics.acceptedQueries).toBe(0)
  expect(solver.eventKernel!.diagnostics.macroExpansions).toBe(0)
  expect(solver.eventKernel!.diagnostics.inputStatesScanned).toBe(2 * plane)
  expect(solver.selectionDiagnostics.nativeDensityQueries).toBe(1)
  expect(work).toBe(solver.eventKernel!.diagnostics.workUnits + solver.selectionDiagnostics.nativeSearchExpansions)
  const parents = new Int32Array(2 * plane)
  query.copyParents(parents)
  let cost = 0
  let count = 0
  for (let state = goal; parents[state] !== -1; state = parents[state]!) {
    const previous = parents[state]!
    const layer = Math.floor(state / plane)
    if (layer !== Math.floor(previous / plane)) cost += 0.8
    else {
      const horizontal = Math.abs(state % solver.cols - previous % solver.cols) === 1
      cost += 1.7 / (solver.cols - 1) * (horizontal ? (layer % 2 ? 1.05 : 1) : (layer % 2 ? 1 : 1.05)) + input.history[state]!
    }
    if (++count > 2 * plane) throw new Error("Native dispatch published a parent cycle")
  }
  expect(cost).toBeCloseTo(oracle, 10)
  const scanned = solver.eventKernel!.diagnostics.inputStatesScanned
  query.begin(input, 0, goal, 0.5)
  expect(solver.selectionDiagnostics.nativeDensityQueries).toBe(2)
  status = 0
  while (status === 0) status = query.run(37, 100_000).status
  expect(status).toBe(1)
  expect(solver.eventKernel!.diagnostics.inputStatesScanned).toBe(scanned)
})
