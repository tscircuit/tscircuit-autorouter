import { expect, test } from "bun:test"
import { DrcCheckpointSolver } from "lib/solvers/DrcCheckpointSolver/DrcCheckpointSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const createRoute = (connectionName: string): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ],
  vias: [],
})

test("DRC checkpoint accepts improvements and rejects regressions", () => {
  for (const candidateDrcCount of [0, 2]) {
    const baselineHdRoutes = [createRoute("baseline")]
    const candidateHdRoutes = [createRoute("candidate")]
    const solver = new DrcCheckpointSolver({
      baselineHdRoutes,
      candidateHdRoutes,
      drcEvaluator: ({ routes }) => ({
        errors: Array.from(
          {
            length: routes === candidateHdRoutes ? candidateDrcCount : 1,
          },
          (_, index) => ({ type: "test_error", index }),
        ),
      }),
    })

    solver.solve()

    expect(solver.getOutput()).toBe(
      candidateDrcCount === 0 ? candidateHdRoutes : baselineHdRoutes,
    )
    expect(solver.stats.accepted).toBe(candidateDrcCount === 0)

    const graphics = solver.visualize()
    expect(
      new Set([
        ...(graphics.lines ?? []).map((line) => line.step),
        ...(graphics.texts ?? []).map((text) => text.step),
      ]),
    ).toEqual(new Set([1, 2, 3]))
    expect(graphics.texts?.map((text) => text.text)).toContain(
      candidateDrcCount === 0
        ? "Decision: accept candidate (DRC did not increase)"
        : "Decision: reject candidate (DRC increased)",
    )
  }
})
