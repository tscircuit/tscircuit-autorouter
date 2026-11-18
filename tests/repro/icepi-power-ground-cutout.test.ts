import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import input from "./fixtures/icepi-power-ground-cutout.json"

test("routes the iCE/Pi power and ground cutout through cramped-port pruning", async (): Promise<void> => {
  // 54 original pads and 45 terminals around U1 and its bottom-side capacitors.
  // Cropped from the full-board plane phase at router 9f91d136 / core 312aa419.
  // Board-world millimeters: +X right, +Y up. Copper starts empty.
  const srj = structuredClone(input) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const drcInput = {
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  expect(evaluateRelaxedDrc(drcInput).errors).toHaveLength(0)
  await expect(
    getBugReportSnapshotSvg(drcInput, { bounds: srj.bounds }),
  ).toMatchSvgSnapshot(import.meta.path)
})
