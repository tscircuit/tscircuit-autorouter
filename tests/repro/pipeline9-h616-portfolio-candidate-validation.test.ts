import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { SimpleRouteJson } from "lib/types"
import { getH616PortfolioRegionFixture } from "tests/fixtures/getH616PortfolioRegionFixture"
import { getH616SvrefCircuitSnapshots } from "tests/fixtures/getH616SvrefCircuitSnapshots"

test("routes the failed SVREF region in the full H616 circuit", async (): Promise<void> => {
  // Replay the next routing step after 604 accepted regions, retaining every
  // native pad and preloaded route. The board has all 125 parts and 264 nets;
  // its DDR layout was captured with tscircuit 0.0.3164.
  const board = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-preloaded-board-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { circuitJson: AnyCircuitElement[]; srj: SimpleRouteJson }
  const fixture = getH616PortfolioRegionFixture(
    new URL(
      "../fixtures/assets/h616-svref-portfolio-region.json.gz",
      import.meta.url,
    ),
  )
  const solver = new Pipeline9HighDensitySolver(fixture.input)
  solver.solve()
  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
  const fixedRoutes = solver.getUpdatedFixedHdRoutes()
  for (const left of [
    ...solver.fixedRouteReplacements.values(),
    ...solver.routes,
  ]) {
    for (const right of [...fixedRoutes, ...solver.routes]) {
      if (arePipeline9RoutesOnSameNet(left, right, solver.connMap)) continue
      expect(
        doPipeline9RoutesHaveCopperConflict({
          left,
          right,
          clearance: board.srj.minTraceToPadEdgeClearance!,
          layerCount: board.srj.layerCount,
        }),
      ).toBeFalse()
    }
  }
  const svrefTrace = board.circuitJson.find(
    (element) =>
      element.type === "source_trace" && element.display_name === "/DRAM/SVREF",
  )!
  if (svrefTrace.type !== "source_trace") throw new Error("Missing SVREF trace")
  const snapshots = getH616SvrefCircuitSnapshots({
    circuitJson: board.circuitJson,
    originalSrj: board.srj,
    srjWithPointPairs: fixture.srjWithPointPairs,
    preloadedRoutes: fixedRoutes,
    hdRoutes: [...fixture.acceptedRoutes, ...solver.routes],
    svrefTrace,
  })
  await expect(snapshots.board).toMatchSvgSnapshot(import.meta.path, {
    scale: 1,
  })
  await expect(snapshots.svref).toMatchSvgSnapshot(import.meta.path, {
    svgName: "ddr",
    scale: 1,
  })
})
