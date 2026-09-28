import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("regional repair accepts explicit vias when clearance projection makes no improvement", (): void => {
  for (const offset of [1, 0.75e-6]) {
    const fixture = createBoundedRegionalRepairFixture()
    fixture.routes.push({
      connectionName: "explicit-via-route",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -3, y: 2, z: 0 },
        { x: -3 + offset, y: 2, z: 1 },
        { x: 2, y: 2, z: 1 },
      ],
      vias: [{ x: -3, y: 2 }],
    })
    const original = structuredClone(fixture.routes)
    const result = applyPipeline9BoundedRegionalRepairs({
      ...fixture,
      drcEvaluator: (): ReturnType<DrcEvaluator> => ({
        errors: [
          {
            type: "pcb_trace_error",
            message: "Unresolved reference error",
          },
        ],
      }),
      budget: { maxRegions: 0, maxCandidateAttempts: 0, maxPathSearchNodes: 0 },
    })
    expect(result.repaired).toBe(false)
    expect(result.routes).toBe(fixture.routes)
    expect(fixture.routes).toEqual(original)
    expect(result.attemptedRegionCount).toBe(0)
  }
})
