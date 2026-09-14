import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { filterPipeline9DrcErrorsAgainstBaseline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/filterPipeline9DrcErrorsAgainstBaseline"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { stackSvgsHorizontally } from "stack-svgs"

const readCompressedFixture = <T>(path: string): T =>
  JSON.parse(
    gunzipSync(
      Uint8Array.from(readFileSync(new URL(path, import.meta.url))),
    ).toString("utf8"),
  ) as T

const unroutedCircuitJson = readCompressedFixture<CircuitJson>(
  "../../fixtures/bug-reports/t113-linux-hdmi-joint-drc/t113-linux-hdmi-unrouted.circuit.json.gz",
)
const srj = readCompressedFixture<SimpleRouteJson>(
  "../../fixtures/bug-reports/t113-linux-microsd-via-pad/t113-linux-microsd-via-pad.srj.json.gz",
)

test("Pipeline9 clears via-to-pad DRC in the exact T113-S3 microSD phase", async () => {
  expect(
    unroutedCircuitJson.filter(
      (element) => element.type === "source_component",
    ),
  ).toHaveLength(96)
  expect(
    unroutedCircuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(96)
  expect(
    unroutedCircuitJson.filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    ),
  ).toEqual([])
  expect(srj.connections).toHaveLength(29)
  expect(srj.obstacles).toHaveLength(397)
  expect(srj.traces).toHaveLength(274)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const routedTraces = solver.getOutputSimpleRouteJson().traces ?? []
  expect(routedTraces).toHaveLength(309)
  const drcOptions = {
    viaPadClearance: srj.minViaEdgeToPadEdgeClearance ?? 0.1,
    includeTraceContinuity: false,
  }
  const baselineDrc = evaluateRelaxedDrc({
    inputSrj: { ...srj, traces: [] },
    srjWithPointPairs: srj,
    routedTraces: srj.traces ?? [],
    drcOptions,
  })
  const finalDrc = evaluateRelaxedDrc({
    inputSrj: { ...srj, traces: [] },
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    drcOptions,
  })
  expect(
    filterPipeline9DrcErrorsAgainstBaseline({
      errors: finalDrc.errors as unknown as Array<Record<string, unknown>>,
      baselineErrors: baselineDrc.errors as unknown as Array<
        Record<string, unknown>
      >,
      originalTraceIdByPreparedTraceId: new Map(),
    }),
  ).toEqual([])

  const routedCopper = convertToCircuitJson(srj, routedTraces).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  expect(
    routedCopper.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(309)
  expect(
    routedCopper.filter((element) => element.type === "pcb_via").length,
  ).toBeGreaterThan(0)
  await expect(
    stackSvgsHorizontally(
      [
        convertCircuitJsonToPcbSvg(unroutedCircuitJson),
        convertCircuitJsonToPcbSvg([
          ...unroutedCircuitJson,
          ...routedCopper,
        ]),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "unrouted-routed",
    tolerance: 0.02,
  })
})
