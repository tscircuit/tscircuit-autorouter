import { expect, test } from "bun:test"
import { checkEachPcbPortConnectedToPcbTraces } from "@tscircuit/checks"
import input from "../../fixtures/bug-reports/beagleplay-am6254-ddr4/input.srj.json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

const srj = input as SimpleRouteJson

test("BeaglePlay DDR4 routes without clearance or port errors", async (): Promise<void> => {
  expect(srj.layerCount).toBe(8)
  expect(srj.obstacles).toHaveLength(521)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBeTrue()

  const drcInput = {
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    includeBoardClearance: true,
    // Use the board's original 0.081 mm clearance for this repro.
    drcOptions: { traceClearance: srj.minTraceToPadEdgeClearance },
  }
  expect(drcInput.routedTraces).toHaveLength(51)
  const { circuitJson, errors } = evaluateRelaxedDrc(drcInput)
  const ports = circuitJson.filter((element) => element.type === "pcb_port")
  expect(ports).toHaveLength(102)

  // The repro reported traces too close (DDR_PARITY / DDR_A6 and DDR_A7)
  // and disconnected DDR ports.
  expect(
    [...errors, ...checkEachPcbPortConnectedToPcbTraces(circuitJson)].map(
      ({ message }) => message,
    ),
  ).toEqual([])
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
