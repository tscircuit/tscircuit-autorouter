import { expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { SimpleRouteJson } from "lib/types"

const ROUTED_NODE_COUNT = 24

test("H616 high-density nodes share one node pf map", (): void => {
  const { inputSrj } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-native-ddr-clearance.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { inputSrj: SimpleRouteJson }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    inputSrj,
    { cacheProvider: null },
  )
  let copiedEntries = 0
  const startRegularSolver = Pipeline9HighDensitySolver.prototype[
    "startRegularSolver" as keyof Pipeline9HighDensitySolver
  ] as (this: Pipeline9HighDensitySolver, node: unknown) => void
  spyOn(
    Pipeline9HighDensitySolver.prototype,
    "startRegularSolver" as keyof Pipeline9HighDensitySolver,
  ).mockImplementation(function (
    this: Pipeline9HighDensitySolver,
    node: unknown,
  ): void {
    startRegularSolver.call(this, node)
    if (this.activeRegularSolver?.nodePfById !== this.nodePfById) {
      copiedEntries += this.nodePfById.size
    }
  })
  pipeline.solveUntilPhase("highDensityRouteSolver")
  pipeline.step()
  const highDensity = pipeline.highDensityRouteSolver!
  while (Number(highDensity.stats.regularNodeCount) < ROUTED_NODE_COUNT) {
    highDensity.step()
  }
  expect(highDensity.failed).toBeFalse()

  const svg = getSvgFromGraphicsObject(
    {
      rects: highDensity.routes.slice(0, 200).map((route) => ({
        center: route.route[0]!,
        width: route.traceThickness,
        height: route.traceThickness,
        fill: "#2563eb",
      })),
    },
    { backgroundColor: "white" },
  )
  const summary = `<g data-testid="node-pf-copies"><rect x="12" y="12" width="470" height="44" rx="6" fill="white" stroke="#166534"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" fill="#166534">Node pf entries copied: ${copiedEntries}</text></g>`
  expect(svg.replace("</svg>", `${summary}</svg>`)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
