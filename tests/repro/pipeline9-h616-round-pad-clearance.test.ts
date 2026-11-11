import { expect, test } from "bun:test"
import { checkViaPadClearance } from "@tscircuit/checks"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import {
  getRoundPadClearanceSnapshot,
  getRoundPadClearanceWitness,
} from "tests/fixtures/roundPadClearanceSnapshot"
import { getRoundPadRegionalFixture } from "tests/fixtures/roundPadRegionalFixture"

test("accepts the H616 via beside the corner of a circular BGA pad", async (): Promise<void> => {
  const { input, srj } = getRoundPadRegionalFixture(
    new URL(
      "../fixtures/assets/h616-round-pad-regional-route.json.gz",
      import.meta.url,
    ),
  )
  const solver = new Pipeline9RegionalFallbackSolver(input)
  const validate = solver.highDensitySolver.growShrinkSolutionValidator!
  const candidates: { routes: HighDensityRoute[]; accepted: boolean }[] = []
  // Observe the real validator without changing which candidates it accepts.
  solver.highDensitySolver.growShrinkSolutionValidator = (routes): boolean => {
    const accepted = validate(routes)
    candidates.push({ routes, accepted })
    return accepted
  }
  solver.solve()
  const witness = candidates
    .map((candidate) => getRoundPadClearanceWitness({ input, ...candidate }))
    .find((candidate) => candidate !== undefined)
  if (!witness) throw new Error("Missing H616 circular-pad clearance candidate")
  const circuit = convertToCircuitJson(srj, [witness.route], {
    minTraceWidth: srj.minTraceWidth,
    minViaDiameter: srj.minViaDiameter,
    minViaHoleDiameter: srj.minViaHoleDiameter,
    connectivityMaps: { source: input.connMap, route: input.connMap },
  })
  expect(
    checkViaPadClearance(circuit, { minClearance: input.viaToPadClearance }),
  ).toEqual([])
  expect(witness.accepted).toBeTrue()
  await expect(
    getRoundPadClearanceSnapshot({
      witness,
      minClearance: input.viaToPadClearance,
      viaHoleDiameter: srj.minViaHoleDiameter!,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
