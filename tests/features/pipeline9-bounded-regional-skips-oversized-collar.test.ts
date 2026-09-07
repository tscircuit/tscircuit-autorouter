import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
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
    const result = applyPipeline9BoundedRegionalRepairs({
      ...fixture,
      drcEvaluator: () => [{ type: "pcb_trace_error", center: { x: 0, y: 0 } }],
    })
    expect(result.routes).toBe(fixture.routes)
    expect(result.routes).toEqual(before)
    expect(result.repaired).toBeFalse()
    expect(result.attemptedRegionCount).toBe(0)
    expect(result.candidateAttemptCount).toBe(0)
    expect(result.referenceValidationCount).toBe(0)
  }

  const invalid = createBoundedRegionalRepairFixture()
  invalid.routes[0]!.viaDiameter = Number.POSITIVE_INFINITY
  expect(() =>
    applyPipeline9BoundedRegionalRepairs({
      ...invalid,
      drcEvaluator: () => [{ type: "pcb_trace_error", center: { x: 0, y: 0 } }],
    }),
  ).toThrow("repair04 requires finite positive copper widths")
})
