import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { stackSvgsHorizontally } from "stack-svgs"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-usb-uart-routing-region/"
const readCompressedFixture = <T>(filename: string): T =>
  JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(new URL(`${fixtureDirectory}${filename}`, import.meta.url)),
      ),
    ).toString("utf8"),
  ) as T

const unroutedCircuitJson = readCompressedFixture<CircuitJson>(
  "t113-linux-usb-uart-routing-region-unrouted.circuit.json.gz",
)
const phaseCaptures = readCompressedFixture<
  Array<{ input: { input: SimpleRouteJson } }>
>("t113-linux-usb-uart-routing-region-phases.json.gz")
const localSocSrj = phaseCaptures[0]!.input.input
const globalSrj = phaseCaptures.at(-1)!.input.input

test("Pipeline9 routes the exact 86-component T113-S3 USB and UART PCB", async () => {
  expect(
    unroutedCircuitJson.filter(
      (element) => element.type === "source_component",
    ),
  ).toHaveLength(86)
  expect(
    unroutedCircuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(86)
  expect(
    unroutedCircuitJson.filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    ),
  ).toEqual([])
  expect(phaseCaptures).toHaveLength(10)
  expect(localSocSrj.boundsArePhysicalBoardEdges).toBe(false)
  expect(localSocSrj.obstacles).toHaveLength(373)
  expect(localSocSrj.connections).toHaveLength(38)
  expect(localSocSrj.traces).toHaveLength(0)
  expect(globalSrj.boundsArePhysicalBoardEdges).toBeUndefined()
  expect(globalSrj.obstacles).toHaveLength(373)
  expect(globalSrj.connections).toHaveLength(26)
  expect(globalSrj.traces).toHaveLength(110)

  const localSocSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(localSocSrj),
    { cacheProvider: null },
  )
  localSocSolver.solve()
  expect(localSocSolver.solved).toBe(true)
  expect(localSocSolver.failed).toBe(false)
  expect(
    evaluateRelaxedDrc({
      includeBoardClearance:
        localSocSrj.boundsArePhysicalBoardEdges !== false,
      inputSrj: localSocSrj,
      srjWithPointPairs: localSocSolver.srjWithPointPairs!,
      routedTraces: localSocSolver.getOutputSimplifiedPcbTraces(),
    }).errors,
  ).toEqual([])

  const globalSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(globalSrj),
    { cacheProvider: null },
  )
  globalSolver.solve()
  expect(globalSolver.solved).toBe(true)
  expect(globalSolver.failed).toBe(false)
  expect(globalSolver.error).toBeNull()
  expect(
    globalSolver.pipeline9JointDrcRepairSolver?.stats
      .clearancePrecisionRepaired,
  ).toBe(true)

  const fixedTraces = (
    globalSolver.powerTraceExpansionSolver!
      .inputSrj as Pipeline7PowerTraceExpansionInput
  ).fixedTraces
  const routedTraces = globalSolver.postPowerTraceViaMergeSolver!.getOutput()
  expect(
    evaluateRelaxedDrc({
      inputSrj: { ...globalSrj, traces: fixedTraces },
      srjWithPointPairs: globalSolver.srjWithPointPairs!,
      routedTraces,
    }).errors,
  ).toEqual([])

  const allRoutedTraces = globalSolver.getOutputSimpleRouteJson().traces ?? []
  const routedCopper = convertToCircuitJson(globalSrj, allRoutedTraces).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  expect(
    routedCopper.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(241)
  expect(
    routedCopper.filter((element) => element.type === "pcb_via"),
  ).toHaveLength(155)
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
    tolerance: 0,
  })
})
