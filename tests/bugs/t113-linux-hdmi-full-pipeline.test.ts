import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { filterPipeline9DrcErrorsAgainstBaseline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/filterPipeline9DrcErrorsAgainstBaseline"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { stackSvgsHorizontally } from "stack-svgs"

const fixtureDirectory = "../../fixtures/bug-reports/t113-linux-hdmi-joint-drc/"
const readCompressedFixture = <T>(filename: string): T =>
  JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(`${fixtureDirectory}${filename}`, import.meta.url),
        ),
      ),
    ).toString("utf8"),
  ) as T

const unroutedCircuitJson = readCompressedFixture<CircuitJson>(
  "t113-linux-hdmi-unrouted.circuit.json.gz",
)
const srj = readCompressedFixture<SimpleRouteJson>(
  "t113-linux-hdmi-full-pipeline.srj.json.gz",
)

test("Pipeline9 routes the exact final T113-S3 HDMI phase", async () => {
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
  expect(srj.traces).toHaveLength(342)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const fixedTraces = (
    solver.powerTraceExpansionSolver!.inputSrj as Pipeline7PowerTraceExpansionInput
  ).fixedTraces
  const routedTraces = solver.postPowerTraceViaMergeSolver!.getOutput()
  const drcOptions = {
    traceClearance: srj.minTraceToPadEdgeClearance ?? 0.1,
    viaPadClearance: srj.minViaEdgeToPadEdgeClearance ?? 0.1,
    includeTraceContinuity: false,
  }
  const baselineDrc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: [],
    drcOptions,
  })
  const finalDrc = evaluateRelaxedDrc({
    inputSrj: { ...srj, traces: fixedTraces },
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
  expect(
    finalDrc.errors.filter(
      (error) =>
        (error as unknown as { type: string }).type ===
        "pcb_pad_pad_clearance_error",
    ),
  ).toEqual([])

  const allRoutedTraces = solver.getOutputSimpleRouteJson().traces ?? []
  const routedCopper = convertToCircuitJson(srj, allRoutedTraces).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  expect(
    routedCopper.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(384)
  expect(
    routedCopper.filter((element) => element.type === "pcb_via").length,
  ).toBeGreaterThan(0)
  await expect(
    stackSvgsHorizontally(
      [
        convertCircuitJsonToPcbSvg(unroutedCircuitJson),
        convertCircuitJsonToPcbSvg([...unroutedCircuitJson, ...routedCopper]),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "unrouted-routed",
    tolerance: 0.02,
  })
})
