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

type NativeOutcome =
  | { kind: "returned"; errors: ReturnType<typeof checkViaTraceClearance> }
  | { kind: "threw"; name: string; message: string }

test("reused via-trace partitions preserve native errors, names, ordering and later failures", (): void => {
  const board: AnyCircuitElement[] = []
  const metadata: SourceSimpleChip[] = []
  for (let index = 0; index < 3; index++) {
    const x = index * 20
    const name: SourceSimpleChip = {
      type: "source_component",
      ftype: "simple_chip",
      source_component_id: `via${index}`,
      name: `Island ${index}`,
    }
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
    // Retained non-copper metadata deliberately shadows each via's primary ID.
    // The native lookup must still see the first matching element in order.
    board.push(name, via, trace)
    metadata.push(name)
  }
  const options = { connMap: new ConnectivityMap({}), minClearance: 0.1 }
  const prepared = createPreparedViaTraceClearanceChecker()
  const originalBoard = structuredClone(board)
  const expected = checkViaTraceClearance([...board], options)
  const firstErrors = prepared(board, options)
  expect(firstErrors).toEqual(expected)
  expect(firstErrors).toHaveLength(3)
  expect(firstErrors.map((error) => error.pcb_via_id)).toEqual([
    "via0",
    "via1",
    "via2",
  ])
  for (const [index, error] of firstErrors.entries()) {
    expect(error.message).toContain(`source_component[Island ${index}]`)
    expect(error.message).toContain(`trace[trace${index}]`)
    expect(error.center).toEqual({ x: index * 20, y: 0.2 })
  }
  expect(board).toEqual(originalBoard)
  const retainedErrors = structuredClone(firstErrors)

  // A later evaluation reads both reordered copper and updated shared naming
  // metadata. Earlier error records must not retain a mutable partition view.
  metadata[0]!.name = "Renamed island"
  const reordered = [
    metadata[0]!,
    ...[...board].reverse().filter((element) => element !== metadata[0]),
  ]
  const secondErrors = prepared(reordered, options)
  expect(secondErrors).toEqual(checkViaTraceClearance([...reordered], options))
  expect(secondErrors.map((error) => error.pcb_via_id)).toEqual([
    "via2",
    "via1",
    "via0",
  ])
  // The first two actual vias now precede their shadows; the renamed shadow
  // remains first for via0. Neither lookup may use the prior partition state.
  expect(secondErrors[0]!.message).toContain("pcb_via[#via2]")
  expect(secondErrors[2]!.message).toContain("source_component[Renamed island]")
  expect(firstErrors).toEqual(retainedErrors)
  expect(prepared.getStats()).toMatchObject({
    evaluationCount: 2,
    partitionedEvaluationCount: 2,
    nativeInvocationCount: 6,
    selectedViaTracePairCount: 6,
  })

  // Malformed external metadata is intentional: new evaluations must still
  // perform native initialization and throw, not retain the previous store.
  Object.defineProperty(metadata[0]!, "source_component_id", { value: 12 })
  const capture = (
    evaluate: () => ReturnType<typeof checkViaTraceClearance>,
  ): NativeOutcome => {
    try {
      return { kind: "returned", errors: evaluate() }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "threw", name: error.name, message: error.message }
    }
  }
  const expectedFailure = capture(() =>
    checkViaTraceClearance([...board], options),
  )
  const actualFailure = capture(() => prepared(board, options))
  expect(expectedFailure.kind).toBe("threw")
  expect(actualFailure).toEqual(expectedFailure)
  expect(firstErrors).toEqual(retainedErrors)
})
