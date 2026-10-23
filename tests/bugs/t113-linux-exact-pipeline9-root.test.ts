import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { stackSvgsHorizontally } from "stack-svgs"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/"

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

test("T113-S3 Pipeline9 completes routing but rejects remaining DRC errors", async () => {
  const circuitJson = readCompressedFixture<CircuitJson>(
    "t113-linux-exact-unrouted.circuit.json.gz",
  )
  const srj = readCompressedFixture<SimpleRouteJson>(
    "t113-linux-exact.srj.json.gz",
  )

  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(96)
  expect(
    circuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(96)
  expect(
    circuitJson.filter(
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

  const finalStage = solver.powerTraceExpansionSolver
  const srjWithPointPairs = solver.srjWithPointPairs
  if (!finalStage || !srjWithPointPairs) {
    throw new Error("T113-S3 routing did not reach its final copper stage")
  }
  expect(finalStage.solved).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  const finalStageInput =
    finalStage.inputSrj as Pipeline7PowerTraceExpansionInput
  const { errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs,
    routedTraces: [
      ...finalStageInput.fixedTraces.filter(
        (trace) => trace.__replaces_pcb_trace_id !== undefined,
      ),
      ...finalStage.getOutput(),
    ],
    includeBoardClearance: true,
    drcOptions: {
      includeTraceContinuity: false,
      traceClearance:
        srj.minTraceToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.traceClearance,
      viaClearance:
        srj.minPadEdgeToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.viaClearance,
    },
  })
  expect(errors.length).toBeGreaterThan(0)
  expect(solver.stats.finalDrcIssueCount).toBe(errors.length)
  expect(solver.error).toContain(`${errors.length} DRC errors remain`)
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
    "Cannot get output before solving is complete",
  )
  expect(() => solver.getOutputSimpleRouteJson()).toThrow(
    "Cannot get output before solving is complete",
  )
  expect(solver.portPointPathingSolver?.solved).toBe(true)
  expect(solver.getNewTracesBeforePowerExpansion()).toHaveLength(42)

  const preloadedFanoutCopper = convertToCircuitJson(
    srj,
    srj.traces ?? [],
  ).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  expect(
    preloadedFanoutCopper.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(342)
  expect(
    preloadedFanoutCopper.filter((element) => element.type === "pcb_via")
      .length,
  ).toBeGreaterThan(0)
  await expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "pcb", tolerance: 0.02 },
  )
  await expect(
    stackSvgsHorizontally(
      [
        convertCircuitJsonToPcbSvg(circuitJson),
        convertCircuitJsonToPcbSvg([...circuitJson, ...preloadedFanoutCopper]),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "unrouted-preloaded-fanout",
    tolerance: 0.02,
  })
})
