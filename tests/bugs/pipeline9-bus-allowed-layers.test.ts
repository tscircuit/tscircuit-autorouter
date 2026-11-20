import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import capturedSrj from "../../fixtures/bug-reports/pipeline9-bus-allowed-layers/input.srj.json"

test("Pipeline 9 routes a two-connection bus on its allowed inner layer", async (): Promise<void> => {
  const input = structuredClone(capturedSrj as SimpleRouteJson)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(2)
  for (const { route } of traces) {
    const vias = route.filter((point) => point.route_type === "via")
    expect(
      vias.map(({ from_layer, to_layer }) => [from_layer, to_layer]),
    ).toEqual([
      ["top", "inner2"],
      ["inner2", "top"],
    ])
    const [startVia, endVia] = vias
    const start = route[0]!
    const end = route.at(-1)!
    if (start.route_type !== "wire" || end.route_type !== "wire") {
      throw new Error("Expected top-layer wires at both terminals")
    }
    expect([start.layer, end.layer]).toEqual(["top", "top"])
    expect(
      Math.hypot(start.x - startVia!.x, start.y - startVia!.y),
    ).toBeLessThan(2)
    expect(Math.hypot(end.x - endVia!.x, end.y - endVia!.y)).toBeLessThan(2)
    const betweenVias = route.slice(
      route.indexOf(startVia!) + 1,
      route.indexOf(endVia!),
    )
    expect(
      new Set(
        betweenVias
          .filter((point) => point.route_type === "wire")
          .map((point) => point.layer),
      ),
    ).toEqual(new Set(["inner2"]))
  }

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
