import { expect, test } from "bun:test"
import type { Bounds } from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

type RegionProbe = {
  state: {
    phase: string
    negotiation?: { region: { bounds: Bounds } }
  }
}

test("regional crops use a finite alternate contact before a finite pad center", (): void => {
  for (const hasAlternateContact of [true, false]) {
    const fixture = createBoundedRegionalRepairFixture()
    const pad = fixture.originalSrj.obstacles[2]!
    pad.center = { x: 0.7, y: 0.14 }
    pad.width = 1.2
    const drcEvaluator: DrcEvaluator = (input) => {
      const reference = fixture.drcEvaluator(input)
      if (Array.isArray(reference)) throw new Error("Expected centered reference")
      return {
        ...reference,
        errorsWithCenters: reference.errors.map((error) => ({
          ...error,
          center: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
          pcb_center: hasAlternateContact
            ? { x: 0.1, y: 0 }
            : { x: Number.NaN, y: 0 },
        })),
      }
    }
    const solver = new Pipeline9BoundedRegionalRepairSolver({
      ...fixture,
      drcEvaluator,
      budget: {
        maxRegions: 1,
        maxCandidateAttempts: 1,
        maxPathSearchNodes: 5000,
      },
    })
    const probe = solver as unknown as RegionProbe
    while (
      !solver.solved &&
      !solver.failed &&
      probe.state.phase !== "negotiate"
    )
      solver.step()
    expect(solver.error).toBeNull()
    expect(probe.state.phase).toBe("negotiate")
    if (!probe.state.negotiation) throw new Error("Expected a repair region")
    const bounds = probe.state.negotiation.region.bounds
    const expected = hasAlternateContact ? { x: 0.1, y: 0 } : pad.center
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(expected.x, 12)
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(expected.y, 12)
  }
})
