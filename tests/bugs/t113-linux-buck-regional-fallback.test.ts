import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { stackSvgsHorizontally } from "stack-svgs"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-buck-regional-fallback/"
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
  "t113-linux-buck-regional-fallback-unrouted.circuit.json.gz",
)
const srj = readCompressedFixture<SimpleRouteJson>(
  "t113-linux-buck-regional-fallback.srj.json.gz",
)

test(
  "Pipeline9 routes the exact T113-S3 BUCK fanout phase",
  async () => {
    expect(
      unroutedCircuitJson.filter(
        (element) => element.type === "source_component",
      ),
    ).toHaveLength(96)
    expect(
      unroutedCircuitJson.filter(
        (element) => element.type === "pcb_component",
      ),
    ).toHaveLength(96)
    expect(
      unroutedCircuitJson.filter(
        (element) => element.type === "pcb_trace" || element.type === "pcb_via",
      ),
    ).toEqual([])
    expect(srj.boundsArePhysicalBoardEdges).toBe(false)
    expect(srj.connections).toHaveLength(42)
    expect(srj.obstacles).toHaveLength(462)
    expect(srj.traces).toHaveLength(166)

    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(srj),
      { cacheProvider: null },
    )
    solver.solve()

    expect(solver.error).toBeNull()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)

    const routedTraces = solver.getOutputSimpleRouteJson().traces ?? []
    expect(routedTraces).toHaveLength(208)
    expect(
      evaluateRelaxedDrc({
        includeBoardClearance: false,
        inputSrj: { ...srj, traces: [] },
        srjWithPointPairs: solver.srjWithPointPairs!,
        routedTraces,
        drcOptions: {
          viaPadClearance: srj.minViaEdgeToPadEdgeClearance ?? 0.1,
          includeTraceContinuity: false,
        },
      }).errors,
    ).toEqual([])

    const routedCopper = convertToCircuitJson(srj, routedTraces).filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    )
    expect(
      routedCopper.filter((element) => element.type === "pcb_trace"),
    ).toHaveLength(208)
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
  },
)
