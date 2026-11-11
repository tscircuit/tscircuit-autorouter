import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

// Native board: https://github.com/butterstick-fpga/butterstick-hardware/blob/0694ddfa9824a07f0c6c6981186e45f80187659c/hardware/ButterStick_r1.0/ButterStick.kicad_pcb
// Keep this slow full-board repro skipped in CI, per Seve.
test.skip("routes ButterStick DDR with per-bus wire layers", async (): Promise<void> => {
  const input = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/butterstick-ddr-bus-layers.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const forbiddenBusNets = new Set<string>()
  const inspectedBusNets = new Set<string>()
  for (const bus of input.buses!) {
    if (!bus.allowedLayers) continue
    for (const trace of routedTraces) {
      if (!bus.connectionNames.includes(trace.connection_name)) continue
      inspectedBusNets.add(trace.connection_name)
      for (let index = 1; index < trace.route.length; index++) {
        const a = trace.route[index - 1]!
        const b = trace.route[index]!
        if (
          (a.route_type !== "wire" && a.route_type !== "via") ||
          (b.route_type !== "wire" && b.route_type !== "via") ||
          (a.x === b.x && a.y === b.y)
        )
          continue
        const layer = a.route_type === "wire" ? a.layer : a.to_layer
        if (!bus.allowedLayers.includes(layer)) {
          forbiddenBusNets.add(trace.connection_name)
        }
      }
    }
  }
  // These are the board's declared clearances, not the relaxed defaults.
  const boardSvg = getBugReportSnapshotSvg({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    drcOptions: { traceClearance: 0.0889, viaToPadClearance: 0.0889 },
  }).replace(
    'data-testid="relaxed-drc-summary"',
    'data-testid="relaxed-drc-summary" transform="translate(400,6) scale(0.65)"',
  )
  const color = forbiddenBusNets.size === 0 ? "#166534" : "#b91c1c"
  const busSummary = `<g data-testid="bus-layer-summary"><rect x="12" y="12" width="380" height="44" rx="6" fill="white" stroke="${color}"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="${color}">Forbidden-layer bus nets: ${forbiddenBusNets.size}</text></g>`
  const svg = boardSvg.replace("</svg>", `${busSummary}</svg>`)
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
  expect(inspectedBusNets).toEqual(
    new Set(
      input.buses!.flatMap((bus): string[] =>
        bus.allowedLayers ? bus.connectionNames : [],
      ),
    ),
  )
  expect(forbiddenBusNets.size).toBe(0)
})
