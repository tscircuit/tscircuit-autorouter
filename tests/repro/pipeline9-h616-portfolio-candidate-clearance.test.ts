import { expect, test } from "bun:test"
import { checkViaPadClearance } from "@tscircuit/checks"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { getClosestRegionalViaPadWitness } from "tests/fixtures/getClosestRegionalViaPadWitness"
import { getH616PortfolioRegionFixture } from "tests/fixtures/getH616PortfolioRegionFixture"
import { getRoundPadClearanceSnapshot } from "tests/fixtures/roundPadClearanceSnapshot"

test("finds a legal H616 DDR via after rejecting the first portfolio candidate", async (): Promise<void> => {
  const fixture = getH616PortfolioRegionFixture(
    new URL(
      "../fixtures/assets/h616-svref-portfolio-region.json.gz",
      import.meta.url,
    ),
  )
  const solver = new Pipeline9HighDensitySolver(fixture.input)
  const observed = new Set<Pipeline9RegionalFallbackSolver>()
  let lastRegional: Pipeline9RegionalFallbackSolver | undefined
  let firstRejected:
    | {
        input: Pipeline9RegionalFallbackSolver["params"]
        routes: HighDensityRoute[]
      }
    | undefined
  while (!solver.solved && !solver.failed) {
    const regional = solver.activeFallbackSolver
    if (regional && !observed.has(regional)) {
      const validate = regional.highDensitySolver.growShrinkSolutionValidator!
      regional.highDensitySolver.growShrinkSolutionValidator = (
        routes,
      ): boolean => {
        const accepted = validate(routes)
        if (!accepted && !firstRejected) {
          firstRejected = {
            input: regional.params,
            routes: structuredClone(materializePipeline9HdRouteVias(routes)),
          }
        }
        return accepted
      }
      observed.add(regional)
      lastRegional = regional
    }
    solver.step()
  }
  if (!firstRejected || !lastRegional) {
    throw new Error("Expected a rejected H616 regional candidate")
  }
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const input = solver.solved ? lastRegional.params : firstRejected.input
  const routes = solver.solved ? lastRegional.getOutput() : firstRejected.routes
  const witness = getClosestRegionalViaPadWitness({
    input,
    routes,
    accepted: solver.solved,
  })
  const circuit = convertToCircuitJson(
    { ...fixture.srjWithPointPairs, obstacles: input.boardObstacles! },
    [witness.route],
    {
      minTraceWidth: fixture.input.traceWidth,
      minViaDiameter: fixture.input.viaDiameter,
      minViaHoleDiameter: fixture.input.viaHoleDiameter,
      connectivityMaps: {
        source: fixture.input.connMap,
        route: fixture.input.connMap,
      },
    },
  )
  expect(
    checkViaPadClearance(circuit, {
      minClearance: fixture.input.viaToPadClearance,
    }).length,
  ).toBe(0)
  await expect(
    getRoundPadClearanceSnapshot({
      witness,
      minClearance: fixture.input.viaToPadClearance!,
      viaHoleDiameter: fixture.input.viaHoleDiameter!,
      useCircularPadEdge: true,
      drawBoundingBox: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
