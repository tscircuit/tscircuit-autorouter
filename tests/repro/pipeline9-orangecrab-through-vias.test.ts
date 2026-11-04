import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { checkTracesAreContiguous } from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

function readOrangeCrabSrj(filename: string): SimpleRouteJson {
  const compressed = readFileSync(
    new URL(
      `../fixtures/assets/orangecrab-through-vias/${filename}.srj.json.gz`,
      import.meta.url,
    ),
  )
  return JSON.parse(gunzipSync(new Uint8Array(compressed)).toString("utf8"))
}

test.failing(
  "routes OrangeCrab remaining signals without shorting through-vias to another DDR net",
  async () => {
    const inputSrj = readOrangeCrabSrj("input")
    const originalInput = structuredClone(inputSrj)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      inputSrj,
      {
        cacheProvider: null,
      },
    )
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.error).toBeNull()
    const routedTraces = solver.getOutputSimplifiedPcbTraces()
    // The independent physical reference uses the actual completed byte copper.
    // The solver still receives the unmodified captured core routing input.
    const referenceSrj = readOrangeCrabSrj("physical-reference")
    const snapshotInput = {
      inputSrj: referenceSrj,
      srjWithPointPairs: referenceSrj,
      routedTraces,
      drcOptions: { traceClearance: 0.089, viaToPadClearance: 0.089 },
    }
    const { errors, circuitJson } = evaluateRelaxedDrc(snapshotInput)
    await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
      import.meta.path,
    )
    expect(referenceSrj.connections).toHaveLength(50)
    expect(referenceSrj.traces).toHaveLength(16)
    expect(inputSrj.connections).toHaveLength(34)
    expect(routedTraces).toHaveLength(36)
    expect(checkTracesAreContiguous(circuitJson)).toEqual([])
    expect(inputSrj).toEqual(originalInput)
    expect(
      errors.filter(
        (error) =>
          error.type === "pcb_trace_error" &&
          error.message.includes("accidental contact"),
      ),
    ).toEqual([])
  },
)
