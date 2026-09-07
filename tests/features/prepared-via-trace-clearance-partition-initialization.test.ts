import { expect, test } from "bun:test"
import { checkViaTraceClearance } from "@tscircuit/checks"
import type {
  AnyCircuitElement,
  PcbTrace,
  PcbVia,
  SourceSimpleChip,
} from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreparedViaTraceClearanceChecker } from "lib/testing/utils/createPreparedViaTraceClearanceChecker"

test("prepared via-trace partitions initialize unchanged metadata once per evaluation", (): void => {
  let metadataIdReads = 0
  const metadata: SourceSimpleChip = {
    type: "source_component",
    ftype: "simple_chip",
    name: "Unreferenced metadata",
    get source_component_id(): string {
      metadataIdReads++
      return "metadata_12"
    },
  }
  const board: AnyCircuitElement[] = [metadata]
  const connMap = new ConnectivityMap({})
  for (let index = 0; index < 3; index++) {
    const x = index * 20
    const trace: PcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: `trace${index}`,
      route: [
        { route_type: "wire", x: x - 1, y: 0.2, width: 0.1, layer: "top" },
        { route_type: "wire", x: x + 1, y: 0.2, width: 0.1, layer: "top" },
      ],
    }
    const via: PcbVia = {
      type: "pcb_via",
      pcb_via_id: `via${index}`,
      x,
      y: 0,
      hole_diameter: 0.1,
      outer_diameter: 0.2,
      layers: ["top"],
    }
    board.push(via, trace)
    connMap.addConnections([[via.pcb_via_id, trace.pcb_trace_id]])
  }
  const options = { connMap, minClearance: 0.1 }
  // Connected pairs deliberately avoid readable-name lookups. The constant
  // getter counts only native primary-ID initialization, never wall-clock time.
  expect(checkViaTraceClearance(board, options)).toEqual([])
  expect(metadataIdReads).toBe(1)
  metadataIdReads = 0

  const prepared = createPreparedViaTraceClearanceChecker()
  for (let evaluation = 1; evaluation <= 2; evaluation++) {
    expect(prepared(board, options)).toEqual([])
    expect(metadataIdReads).toBe(evaluation)
    expect(prepared.getStats()).toMatchObject({
      evaluationCount: evaluation,
      partitionedEvaluationCount: evaluation,
      nativeInvocationCount: 3 * evaluation,
      totalViaTracePairCount: 9 * evaluation,
      selectedViaTracePairCount: 3 * evaluation,
      totalViaSegmentPairCount: 9 * evaluation,
      selectedViaSegmentPairCount: 3 * evaluation,
    })
  }
})
