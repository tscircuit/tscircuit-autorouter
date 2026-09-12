import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { stackSvgsHorizontally } from "stack-svgs"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-post-power-via-clearance/"
const readCompressedFixture = (filename: string): string =>
  gunzipSync(
    Uint8Array.from(
      readFileSync(new URL(`${fixtureDirectory}${filename}`, import.meta.url)),
    ),
  ).toString("utf8")
const circuitJson = JSON.parse(
  readCompressedFixture("t113-linux-post-power-via-clearance.circuit.json.gz"),
) as CircuitJson
const srj = JSON.parse(
  readCompressedFixture("t113-linux-post-power-via-clearance.srj.json.gz"),
) as SimpleRouteJson

const renderExactBoard = (routedTraces: SimplifiedPcbTraces): string => {
  const routedCopper = convertToCircuitJson(srj, routedTraces).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  return convertCircuitJsonToPcbSvg([...circuitJson, ...routedCopper])
}

test("Pipeline9 clears post-power vias on the exact T113-S3 PCB", async () => {
  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(56)
  expect(
    circuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(56)
  expect(
    circuitJson.filter((element) => element.type === "pcb_port"),
  ).toHaveLength(275)
  expect(
    circuitJson.filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    ),
  ).toEqual([])
  expect(srj.obstacles).toHaveLength(275)
  expect(srj.traces).toHaveLength(56)
  expect(srj.connections).toHaveLength(7)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  const beforeMergeTraces = solver.powerTraceExpansionSolver!.getOutput()
  const afterMergeTraces = solver.postPowerTraceViaMergeSolver!.getOutput()
  const fixedTraces = (
    solver.powerTraceExpansionSolver!
      .inputSrj as Pipeline7PowerTraceExpansionInput
  ).fixedTraces
  expect(beforeMergeTraces).toHaveLength(107)
  expect(afterMergeTraces).toHaveLength(107)
  expect(fixedTraces).toHaveLength(35)

  const beforeDrc = evaluateRelaxedDrc({
    inputSrj: { ...srj, traces: fixedTraces },
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: beforeMergeTraces,
  })
  const afterDrc = evaluateRelaxedDrc({
    inputSrj: { ...srj, traces: fixedTraces },
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: afterMergeTraces,
  })
  expect(beforeDrc.errors.map((error) => error.type)).toEqual([
    "pcb_via_clearance_error",
  ])
  expect(afterDrc.errors).toEqual([])

  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path

  await expect(
    stackSvgsHorizontally(
      [
        renderExactBoard([...fixedTraces, ...beforeMergeTraces]),
        renderExactBoard([...fixedTraces, ...afterMergeTraces]),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(snapshotPath, {
    svgName: "before-after",
    tolerance: 0,
  })
})
