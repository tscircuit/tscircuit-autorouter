import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  createPreparedGetDrcErrors,
  getDrcErrors,
  type GetDrcErrorsOptions,
  type GetDrcErrorsResult,
} from "lib/testing/getDrcErrors"

test("prepared DRC reuses only identical via-spacing dependencies and preserves full official results", (): void => {
  const options: GetDrcErrorsOptions = {
    includeTraceContinuity: false,
    includeBoardEdge: false,
    traceClearance: 0.1,
    viaClearance: 0.1,
  }
  const traceA: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace-a",
    source_trace_id: "net-a",
    route: [
      { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const traceB: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace-b",
    source_trace_id: "net-b",
    route: [
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const board: AnyCircuitElement[] = [
    {
      type: "source_trace",
      source_trace_id: "net-a",
      connected_source_port_ids: ["source-port-a"],
      connected_source_net_ids: [],
    },
    {
      type: "source_trace",
      source_trace_id: "net-b",
      connected_source_port_ids: ["source-port-b"],
      connected_source_net_ids: [],
    },
    {
      type: "pcb_port",
      pcb_port_id: "port-a",
      source_port_id: "source-port-a",
      x: -2,
      y: 0,
      layers: ["top"],
    },
    {
      type: "pcb_port",
      pcb_port_id: "port-b",
      source_port_id: "source-port-b",
      x: 2,
      y: 0,
      layers: ["top"],
    },
    {
      type: "pcb_via",
      pcb_via_id: "via_0",
      pcb_trace_id: "trace-a",
      x: 0,
      y: 0,
      hole_diameter: 0.2,
      outer_diameter: 0.3,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_via",
      pcb_via_id: "via_1",
      pcb_trace_id: "trace-b",
      x: 0.25,
      y: 0,
      hole_diameter: 0.2,
      outer_diameter: 0.3,
      layers: ["top", "bottom"],
    },
    traceA,
    traceB,
  ]
  const originalBoard = structuredClone(board)
  const prepared = createPreparedGetDrcErrors()
  const compareWithFresh = (
    circuitJson: AnyCircuitElement[],
    expectedCacheHit: boolean,
    drcOptions: GetDrcErrorsOptions = options,
  ): GetDrcErrorsResult => {
    const actualInput = structuredClone(circuitJson)
    const expectedInput = structuredClone(circuitJson)
    const before = prepared.getStats()
    const actual = prepared(actualInput, drcOptions)
    const expected = getDrcErrors(expectedInput, drcOptions)
    expect(actual).toEqual(expected)
    expect(actualInput).toEqual(expectedInput)
    const after = prepared.getStats()
    expect(after.viaSpacingCacheHitCount - before.viaSpacingCacheHitCount).toBe(
      expectedCacheHit ? 1 : 0,
    )
    expect(
      after.viaSpacingEvaluationCount - before.viaSpacingEvaluationCount,
    ).toBe(expectedCacheHit ? 0 : 1)
    return actual
  }
  const initial = compareWithFresh(board, false)
  expect(initial.errors).toHaveLength(1)
  expect(initial.errors[0]).toMatchObject({
    type: "pcb_via_clearance_error",
    pcb_error_id: "different_net_vias_close_via_0_via_1",
  })
  const wireOnly = board.map((element): AnyCircuitElement => {
    if (element.type !== "pcb_trace" || element.pcb_trace_id !== "trace-a") {
      return element
    }
    return {
      ...element,
      route: [
        element.route[0]!,
        { route_type: "wire", x: -1.5, y: -0.5, width: 0.1, layer: "top" },
        element.route[1]!,
      ],
    }
  })
  const reused = compareWithFresh(wireOnly, true)
  expect(prepared.getStats()).toMatchObject({
    connectivityConstructionCount: 1,
    connectivityCacheHitCount: 1,
  })
  const mutatedError = reused.errors.find(
    (error) => error.type === "pcb_via_clearance_error",
  )
  if (!mutatedError || !mutatedError.pcb_via_ids || !mutatedError.pcb_center) {
    throw new Error("Via-spacing cache fixture requires its complete error")
  }
  mutatedError.message = "mutated result only"
  mutatedError.pcb_via_ids.push("mutated-owner")
  mutatedError.pcb_center.x = 99
  compareWithFresh(wireOnly, true)

  const movedVia = board.map(
    (element): AnyCircuitElement =>
      element.type === "pcb_via" && element.pcb_via_id === "via_1"
        ? { ...element, x: 0.5 }
        : element,
  )
  expect(compareWithFresh(movedVia, false).errors).toHaveLength(0)
  const deletedVia = board.filter(
    (element) => element.type !== "pcb_via" || element.pcb_via_id !== "via_1",
  )
  expect(compareWithFresh(deletedVia, false).errors).toHaveLength(0)
  const reorderedVias = [
    ...board.slice(0, 4),
    board[5]!,
    board[4]!,
    ...board.slice(6),
  ]
  expect(compareWithFresh(reorderedVias, false).errors[0]).toMatchObject({
    pcb_via_ids: ["via_1", "via_0"],
  })
  const changedHole = board.map(
    (element): AnyCircuitElement =>
      element.type === "pcb_via" && element.pcb_via_id === "via_1"
        ? { ...element, hole_diameter: 0.3 }
        : element,
  )
  compareWithFresh(changedHole, false)
  const nonFiniteHole = board.map(
    (element): AnyCircuitElement =>
      element.type === "pcb_via" && element.pcb_via_id === "via_1"
        ? { ...element, hole_diameter: Number.NaN }
        : element,
  )
  compareWithFresh(nonFiniteHole, false)
  const infiniteHole = nonFiniteHole.map(
    (element): AnyCircuitElement =>
      element.type === "pcb_via" && element.pcb_via_id === "via_1"
        ? { ...element, hole_diameter: Number.POSITIVE_INFINITY }
        : element,
  )
  compareWithFresh(infiniteHole, false)
  const mergedNets = board.map(
    (element): AnyCircuitElement =>
      element.type === "source_trace" && element.source_trace_id === "net-b"
        ? { ...element, connected_source_port_ids: ["source-port-a"] }
        : element,
  )
  expect(compareWithFresh(mergedNets, false).errors[0]).toMatchObject({
    pcb_error_id: "same_net_vias_close_via_0_via_1",
  })
  const renamedNet = board.map((element): AnyCircuitElement => {
    if (
      element.type === "source_trace" &&
      element.source_trace_id === "net-a"
    ) {
      return { ...element, source_trace_id: "renamed-net-a" }
    }
    if (element.type === "pcb_trace" && element.source_trace_id === "net-a") {
      return { ...element, source_trace_id: "renamed-net-a" }
    }
    return element
  })
  compareWithFresh(renamedNet, false)
  compareWithFresh(renamedNet, false, { ...options, viaClearance: 0.2 })
  compareWithFresh(renamedNet, false, { ...options, viaClearance: Number.NaN })
  compareWithFresh(renamedNet, false, {
    ...options,
    viaClearance: Number.POSITIVE_INFINITY,
  })
  compareWithFresh(renamedNet, true, {
    ...options,
    viaClearance: Number.POSITIVE_INFINITY,
  })
  // PCB trace encounter order changes generated net labels without changing
  // connectivity membership or the physical via order.
  const relabeledNets = [...board.slice(0, 6), board[7]!, board[6]!]
  const getFirstViaNetLabel = (
    circuitJson: AnyCircuitElement[],
  ): string | undefined => {
    const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
    const viaConnections = circuitJson.flatMap((element): string[][] => {
      if (
        element.type !== "pcb_via" ||
        typeof element.pcb_trace_id !== "string"
      ) {
        return []
      }
      return [[element.pcb_via_id, element.pcb_trace_id]]
    })
    // Match getDrcErrors' explicit via-owner augmentation; the source-only
    // connectivity conversion does not itself assign these physical vias.
    connMap.addConnections(viaConnections)
    return connMap.getNetConnectedToId("via_0")
  }
  const originalNetLabel = getFirstViaNetLabel(board)
  const reorderedNetLabel = getFirstViaNetLabel(relabeledNets)
  expect(originalNetLabel).toBeDefined()
  expect(reorderedNetLabel).toBeDefined()
  expect(reorderedNetLabel).not.toBe(originalNetLabel)
  compareWithFresh(relabeledNets, false)

  // Arbitrary callers may put a trace before an identically named via. The
  // official message then uses that trace's inferred endpoint port identities.
  const shadowingTrace: PcbTrace = { ...traceA, pcb_trace_id: "via_0" }
  const shadowed = [shadowingTrace, ...board]
  const shadowedResult = compareWithFresh(shadowed, false)
  const changedShadowEndpoint = [
    {
      ...shadowingTrace,
      route: [
        {
          route_type: "wire" as const,
          x: 2,
          y: 0,
          width: 0.1,
          layer: "top" as const,
        },
        shadowingTrace.route[1]!,
      ],
    },
    ...board,
  ]
  const changedNameResult = compareWithFresh(changedShadowEndpoint, false)
  const firstViaError = shadowedResult.errors.find(
    (error) => error.type === "pcb_via_clearance_error",
  )
  const changedViaError = changedNameResult.errors.find(
    (error) => error.type === "pcb_via_clearance_error",
  )
  expect(firstViaError).toBeDefined()
  expect(changedViaError).toBeDefined()
  expect(changedViaError!.message).not.toBe(firstViaError!.message)

  const mutableInput = structuredClone(board)
  prepared(mutableInput, options)
  const via = mutableInput.find((element) => element.type === "pcb_via")
  if (!via) throw new Error("Via-spacing cache fixture requires its input via")
  via.hole_diameter = 0.35
  const beforeMutationCheck = prepared.getStats()
  expect(prepared(mutableInput, options)).toEqual(
    getDrcErrors(structuredClone(mutableInput), options),
  )
  expect(prepared.getStats().viaSpacingEvaluationCount).toBe(
    beforeMutationCheck.viaSpacingEvaluationCount + 1,
  )
  expect(board).toEqual(originalBoard)
})
