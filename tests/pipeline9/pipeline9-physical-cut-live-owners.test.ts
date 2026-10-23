import { expect, test } from "bun:test"
import { OutsideInPartialRipTinyHyperGraphSolver, SelectiveReripTinyHyperGraphSolver, TinyHyperGraphSectionSolver, TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { createPhysicalCutTinyProblem } from "../fixtures/createPhysicalCutTinyProblem"

test("K=1 keeps two geometric slots, counts distinct net owners live, and restores capacity after full/partial rip-up", () => {
  const { topology, problem, solution, tracker } = createPhysicalCutTinyProblem()
  const core = new TinyHyperGraphSolver(topology, problem)
  const selective = new SelectiveReripTinyHyperGraphSolver(topology, problem)
  const partial = new OutsideInPartialRipTinyHyperGraphSolver(topology, problem)
  const section = new TinyHyperGraphSectionSolver(topology, problem, solution)
  section.step()
  const sectionInternals = section as unknown as { baselineSolver: TinyHyperGraphSolver; sectionSolver: TinyHyperGraphSolver }
  expect(sectionInternals.sectionSolver).toBeInstanceOf(TinyHyperGraphSolver)
  for (const solver of [core, selective, partial, sectionInternals.baselineSolver, sectionInternals.sectionSolver]) {
    solver.state.portAssignment.fill(-1)
    solver.state.currentRouteNetId = 10
    expect(solver.isPortReservedForDifferentNet(1)).toBe(false)
    solver.state.portAssignment[0] = 20
    // Slot 1 stays free. Only the OTHER slot's shared net resource is full.
    expect(solver.state.portAssignment[1]).toBe(-1)
    expect(solver.isPortReservedForDifferentNet(1)).toBe(true)
    solver.state.currentRouteNetId = 20
    expect(solver.isPortReservedForDifferentNet(1)).toBe(false)
    // A same-net task may use a different free slot in the same cut.
    solver.state.currentRouteNetId = 10
    solver.resetRoutingStateForRerip()
    solver.state.currentRouteNetId = 10
    expect(solver.isPortReservedForDifferentNet(1)).toBe(false)
    // Partial backtracking mutates the same array within the same iteration.
    // Reading owners live must observe both addition and removal immediately.
    solver.state.portAssignment[0] = 20
    expect(solver.isPortReservedForDifferentNet(1)).toBe(true)
    solver.state.portAssignment[0] = -1
    expect(solver.isPortReservedForDifferentNet(1)).toBe(false)
  }
  expect(topology.portCount).toBe(4)
  expect(tracker.stats.physicalCutCapacityRejections).toBe(10)
  expect(tracker.stats.physicalCutSameNetReuse).toBe(5)
  expect(tracker.stats.physicalCutAssignmentReads).toBeGreaterThan(0)
})
