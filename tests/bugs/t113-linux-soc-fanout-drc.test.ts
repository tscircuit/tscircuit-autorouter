import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { filterPipeline9DrcErrorsAgainstBaseline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/filterPipeline9DrcErrorsAgainstBaseline"
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
  "t113-linux-soc-fanout-phase-input.json.gz",
)

test("Pipeline9 clears mixed DRC errors in the exact T113-S3 fanout phase", async () => {
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
  expect(srj.connections).toHaveLength(80)
  expect(srj.traces).toHaveLength(33)
  expect(srj.obstacles).toHaveLength(462)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.pipeline9JointDrcRepairSolver?.stats).toMatchObject({
    postExactReferenceAccepted: true,
    postExactReferenceDrcIssueCount: 0,
    viaPadEscapeRemainingDrcIssueCount: 0,
  })

  const powerInput = solver.powerTraceExpansionSolver!
    .inputSrj as Pipeline7PowerTraceExpansionInput
  const routedTraces = solver.postPowerTraceViaMergeSolver!.getOutput()
  expect(powerInput.fixedTraces).toHaveLength(33)
  expect(routedTraces).toHaveLength(90)
  const drcOptions = {
    traceClearance: srj.minTraceToPadEdgeClearance ?? 0.1,
    viaPadClearance: srj.minViaEdgeToPadEdgeClearance ?? 0.1,
  }
  const baselineDrc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: [],
    drcOptions,
  })
  const finalDrc = evaluateRelaxedDrc({
    inputSrj: { ...srj, traces: powerInput.fixedTraces },
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

  const routedCopper = convertToCircuitJson(solver.srjWithPointPairs!, [
    ...powerInput.fixedTraces,
    ...routedTraces,
  ]).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  expect(
    routedCopper.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(123)
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
}, 180_000)
