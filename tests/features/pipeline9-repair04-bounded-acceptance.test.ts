import type { Repair04Solver } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("repair04 clears a reference DRC issue using only a bounded child input and preserves outside routing", () => {
  const fixture = createPipeline9Repair04Fixture()
  const originalSrj = structuredClone(fixture.srj)
  const originalRoutes = structuredClone(fixture.hdRoutes)
  const before = fixture.referenceDrcEvaluator({
    routes: fixture.hdRoutes,
    traces: [],
  })
  const beforeErrors = Array.isArray(before) ? before : before.errors
  expect(beforeErrors.length).toBeGreaterThan(0)
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    maxRegions: 1,
    maxCandidatesPerRegion: 2000,
  })
  solver.step()
  const child = (solver as unknown as { localSolver: Repair04Solver })
    .localSolver
  expect(child).toBeTruthy()
  const [childInput] = child.getConstructorParams()
  expect(
    childInput.bounds.maxX - childInput.bounds.minX,
  ).toBeGreaterThanOrEqual(10)
  expect(
    childInput.bounds.maxY - childInput.bounds.minY,
  ).toBeGreaterThanOrEqual(10)
  expect(childInput.srj.bounds).not.toEqual(fixture.srj.bounds)
  expect(childInput.srj.obstacles.length).toBeLessThan(
    fixture.srj.obstacles.length,
  )
  expect(childInput.routes.length).toBeLessThan(fixture.hdRoutes.length)
  expect(
    childInput.srj.obstacles.some((obstacle) =>
      obstacle.connectedTo.includes("pcb_smtpad_distant"),
    ),
  ).toBe(false)
  expect(
    childInput.srj.connections.some(
      (connection) => connection.name === "distant-signal",
    ),
  ).toBe(false)
  expect(childInput.srj.traces).toEqual([])
  expect("routeMappings" in childInput).toBe(false)
  expect("originalSrj" in childInput).toBe(false)
  expect(
    childInput.routes
      .flatMap((route) => route.route)
      .every((point) => Math.abs(point.x) < 10 && Math.abs(point.y) < 10),
  ).toBe(true)

  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const output = solver.getOutput()
  const after = fixture.referenceDrcEvaluator({ routes: output, traces: [] })
  expect(Array.isArray(after) ? after : after.errors).toEqual([])
  expect(solver.stats.acceptedRegions).toBe(1)
  expect(output[0]!.route[0]).toEqual(originalRoutes[0]!.route[0])
  expect(output[0]!.route.at(-1)).toEqual(originalRoutes[0]!.route.at(-1))
  expect(output[0]!.route.filter((point) => Math.abs(point.x) >= 8)).toEqual(
    originalRoutes[0]!.route.filter((point) => Math.abs(point.x) >= 8),
  )
  expect(output[1]).toEqual(originalRoutes[1])
  expect(fixture.srj).toEqual(originalSrj)
  expect(fixture.hdRoutes).toEqual(originalRoutes)
})
