import { expect, test } from "bun:test"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import {
  getRoundPadRegionalFixture,
  getRoundPadRegionalViaPadErrors,
} from "tests/fixtures/roundPadRegionalFixture"

test("routes the Glider LVDS region beside circular BGA pads", (): void => {
  const fixture = getRoundPadRegionalFixture(
    new URL(
      "../fixtures/assets/glider-round-pad-regional-route.json.gz",
      import.meta.url,
    ),
  )
  const solver = new Pipeline9RegionalFallbackSolver(fixture.input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(getRoundPadRegionalViaPadErrors({ ...fixture, solver })).toEqual([])
})
