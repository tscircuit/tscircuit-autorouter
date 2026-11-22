import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "./assets/bluetooth-gamepad.srj.json"

test("copper DRC on the four-layer Bluetooth gamepad", async (): Promise<void> => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      // Connectivity through the poured planes is resolved by the board renderer.
      includeTraceContinuity: false,
    },
  }
  const { errors, locationAwareErrors } = evaluateRelaxedDrc(snapshotInput)
  expect(locationAwareErrors).toHaveLength(errors.length)
  const contacts = errors.filter((error) =>
    error.message.includes("accidental contact"),
  )
  expect(contacts).toHaveLength(0)
  expect(errors.length).toMatchInlineSnapshot(`0`)
  await expect(
    getBugReportSnapshotSvg(snapshotInput, { showErrorLocations: true }),
  ).toMatchSvgSnapshot(import.meta.path)
})
