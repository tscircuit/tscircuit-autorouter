import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

type Fixture = ReturnType<typeof createBoundedRegionalRepairFixture>

test("bounded regional repair skips copper whose safety collar cannot fit its fixed region", (): void => {
  const widenCollar: Array<(fixture: Fixture) => void> = [
    (fixture) => {
      fixture.originalSrj.minTraceWidth = 7.8
    },
    (fixture) => {
      fixture.originalSrj.minViaDiameter = 7.8
    },
    (fixture) => {
      fixture.routes[0]!.traceThickness = 7.8
    },
    (fixture) => {
      fixture.routes[0]!.viaDiameter = 7.8
    },
    (fixture) => {
      fixture.routes[0]!.route[1]!.traceThickness = 7.8
    },
    (fixture) => {
      fixture.originalSrj.defaultObstacleMargin = 7.7
    },
    (fixture) => {
      fixture.originalSrj.minTraceToPadEdgeClearance = 7.7
    },
    (fixture) => {
      fixture.originalSrj.minViaEdgeToPadEdgeClearance = 7.7
    },
  ]
  for (const configure of widenCollar) {
    const fixture = createBoundedRegionalRepairFixture()
    configure(fixture)
    const before = structuredClone(fixture.routes)
    const solver = new Pipeline9BoundedRegionalRepairSolver({
      ...fixture,
      drcEvaluator: () => [{ type: "pcb_trace_error", center: { x: 0, y: 0 } }],
    })
    while (!solver.solved && !solver.failed) solver.step()
    expect(solver.error).toBeNull()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    const result = solver.getResult()
    expect(result.routes).toBe(fixture.routes)
    expect(result.routes).toEqual(before)
    expect(result.repaired).toBeFalse()
    expect(result.attemptedRegionCount).toBe(0)
    expect(result.candidateAttemptCount).toBe(0)
    expect(result.referenceValidationCount).toBe(0)
  }

  const invalid = createBoundedRegionalRepairFixture()
  invalid.routes[0]!.viaDiameter = Number.POSITIVE_INFINITY
  expect(() => {
    const solver = new Pipeline9BoundedRegionalRepairSolver({
      ...invalid,
      drcEvaluator: () => [{ type: "pcb_trace_error", center: { x: 0, y: 0 } }],
    })
    while (!solver.solved && !solver.failed) solver.step()
  }).toThrow("repair04 requires finite positive copper widths")
})
