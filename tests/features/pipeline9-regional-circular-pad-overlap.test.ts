import { expect, test } from "bun:test"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { getRoundPadRegionalFixture } from "tests/fixtures/roundPadRegionalFixture"

test("regional routing rejects a via that overlaps a foreign circular pad", (): void => {
  const { input } = getRoundPadRegionalFixture(
    new URL(
      "../fixtures/assets/h616-round-pad-regional-route.json.gz",
      import.meta.url,
    ),
  )
  const node = input.nodeWithPortPoints
  // This pad covers the region, leaving no legal site for its preloaded via.
  const padDiameter = Math.hypot(node.width, node.height)
  const solver = new Pipeline9RegionalFallbackSolver({
    ...input,
    boardObstacles: [
      {
        type: "rect",
        shape: "circle",
        center: node.center,
        width: padDiameter,
        height: padDiameter,
        layers: Array.from({ length: input.layerCount }, (_, z) =>
          mapZToLayerName(z, input.layerCount),
        ),
        connectedTo: ["foreign_pad"],
      },
    ],
  })
  solver.solve()
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
})
