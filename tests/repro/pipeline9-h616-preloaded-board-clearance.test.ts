import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getH616SvrefCircuitSnapshots } from "tests/fixtures/getH616SvrefCircuitSnapshots"

test("captures H616 SVREF routing beside preloaded DDR copper", async (): Promise<void> => {
  // All 125 components and 264 nets from Kononenko-K/Allwinner_H616_Devboard,
  // commit 94fe1071ff3d7c2e6a227a3e4dfccb6acae305c4. Captured after the
  // three DDR phases in tscircuit 0.0.3164, before routing the other signals.
  const fixture = JSON.parse(
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
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.srj,
    { cacheProvider: null },
  )
  let regionalNode: NodeWithPortPoints | undefined
  expect((): void => {
    while (!pipeline.solved && !pipeline.failed) {
      const regionalSolver =
        pipeline.highDensityRouteSolver?.activeFallbackSolver
      if (regionalSolver) {
        regionalNode = regionalSolver.params.nodeWithPortPoints
      }
      pipeline.step()
    }
  }).not.toThrow()
  expect(pipeline.solved).toBeFalse()
  expect(pipeline.failed).toBeTrue()
  const svrefTrace = fixture.circuitJson.find(
    (element) =>
      element.type === "source_trace" && element.display_name === "/DRAM/SVREF",
  )!
  if (svrefTrace.type !== "source_trace") throw new Error("Missing SVREF trace")
  // Show only accepted routing-stage segments. A partial stage is not a
  // completed PCB, and missing connections are never filled in for the SVG.
  const snapshots = getH616SvrefCircuitSnapshots({
    circuitJson: fixture.circuitJson,
    originalSrj: pipeline.originalSrj,
    srjWithPointPairs: pipeline.srjWithPointPairs!,
    preloadedRoutes: pipeline.highDensityRouteSolver!.getUpdatedFixedHdRoutes(),
    hdRoutes: pipeline.highDensityRouteSolver!.routes,
    svrefTrace,
    regionalNode,
  })
  await expect(snapshots.board).toMatchSvgSnapshot(import.meta.path, {
    scale: 1,
  })
  await expect(snapshots.svref).toMatchSvgSnapshot(import.meta.path, {
    svgName: "ddr",
    scale: 1,
  })
})
