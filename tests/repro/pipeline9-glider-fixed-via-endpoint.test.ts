import { expect, test } from "bun:test"
import {
  checkEachPcbPortConnectedToPcbTraces,
  checkSourceTracesHavePcbTraces,
  checkTracesAreContiguous,
} from "@tscircuit/checks"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

function readGliderSrj(name: string): SimpleRouteJson {
  const path = new URL(
    `../../fixtures/repro/glider-ddr-addr6/${name}.srj.json.gz`,
    import.meta.url,
  )
  return JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(path))).toString("utf8"),
  )
}

test("routes Glider ADDR6 through its fixed escape via beside sixteen data signals", async (): Promise<void> => {
  const inputSrj = readGliderSrj("input")
  const originalInput = structuredClone(inputSrj)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()

  // The router receives the exact captured phase input. Validate its output
  // against all native pads and actual earlier copper, not obstacle projections.
  const referenceSrj = readGliderSrj("physical-reference")
  const snapshotInput = {
    inputSrj: referenceSrj,
    srjWithPointPairs: {
      ...referenceSrj,
      connections: [
        ...referenceSrj.connections.slice(0, 16),
        ...solver.srjWithPointPairs!.connections,
      ],
    },
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    drcOptions: { traceClearance: 0.11, viaToPadClearance: 0.11 },
  }
  const { circuitJson } = evaluateRelaxedDrc(snapshotInput)
  expect(referenceSrj.connections).toHaveLength(49)
  expect(referenceSrj.traces).toHaveLength(16)
  expect(checkTracesAreContiguous(circuitJson)).toEqual([])
  expect(checkEachPcbPortConnectedToPcbTraces(circuitJson)).toEqual([])
  expect(checkSourceTracesHavePcbTraces(circuitJson)).toEqual([])
  expect(inputSrj).toEqual(originalInput)
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
