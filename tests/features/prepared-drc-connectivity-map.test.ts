import { expect, test } from "bun:test"
import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkSameNetViaSpacing,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import {
  type ConnectivityMap,
  getFullConnectivityMapFromCircuitJson,
} from "circuit-json-to-connectivity-map"
import { createPreparedDrcConnectivityMap } from "lib/testing/utils/createPreparedDrcConnectivityMap"

test("prepared connectivity preserves exact ordered declarations and augmentation semantics", (): void => {
  const board: AnyCircuitElement[] = [
    {
      type: "source_trace",
      source_trace_id: "source-a",
      connected_source_port_ids: ["sp-a", "sp-a2"],
      connected_source_net_ids: ["net-a", "net-a2"],
    },
    {
      type: "source_trace",
      source_trace_id: "source-b",
      connected_source_port_ids: ["sp-b"],
      connected_source_net_ids: ["net-b"],
    },
    {
      type: "pcb_port",
      pcb_port_id: "port-a",
      source_port_id: "sp-a",
      x: -1,
      y: 0,
      layers: ["top"],
    },
    {
      type: "pcb_port",
      pcb_port_id: "port-b",
      source_port_id: "sp-b",
      x: -1,
      y: 0.3,
      layers: ["top"],
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad-a",
      pcb_port_id: "port-a",
      x: -1,
      y: 0,
      shape: "rect",
      width: 0.2,
      height: 0.2,
      layer: "top",
    },
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "hole-b",
      pcb_port_id: "port-b",
      x: -1,
      y: 0.3,
      shape: "circle",
      hole_diameter: 0.1,
      outer_diameter: 0.2,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace-a",
      source_trace_id: "source-a",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace-b",
      source_trace_id: "source-b",
      route: [
        { route_type: "wire", x: -1, y: 0.3, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0.3, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_via",
      pcb_via_id: "via-a",
      pcb_trace_id: "trace-a",
      x: -0.5,
      y: 0.05,
      hole_diameter: 0.1,
      outer_diameter: 0.2,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_via",
      pcb_via_id: "via-b",
      pcb_trace_id: "trace-b",
      x: -0.25,
      y: 0.1,
      hole_diameter: 0.1,
      outer_diameter: 0.2,
      layers: ["top", "bottom"],
    },
  ]
  const original = structuredClone(board)
  const getViaPairs = (
    circuitJson: AnyCircuitElement[],
  ): Array<[string, string]> => {
    return circuitJson.flatMap((element): Array<[string, string]> => {
      if (
        element.type !== "pcb_via" ||
        typeof element.pcb_trace_id !== "string"
      ) {
        return []
      }
      return [[element.pcb_via_id, element.pcb_trace_id]]
    })
  }
  const prepared = createPreparedDrcConnectivityMap()
  let previousMap: ConnectivityMap | undefined
  const compareWithNative = (
    circuitJson: AnyCircuitElement[],
    augmentation: Iterable<readonly [string, string]>,
    expectedHit: boolean,
  ): ConnectivityMap => {
    const pairs = Array.from(
      augmentation,
      ([viaId, traceId]): [string, string] => [viaId, traceId],
    )
    const before = prepared.getStats()
    const actual = prepared(circuitJson, pairs)
    const expected = getFullConnectivityMapFromCircuitJson(circuitJson)
    expected.addConnections(pairs)
    expect(actual.netMap).toEqual(expected.netMap)
    expect(actual.idToNetMap).toEqual(expected.idToNetMap)
    const ids = new Set([
      ...Object.keys(expected.idToNetMap),
      ...Object.keys(expected.netMap),
    ])
    for (const left of ids) {
      for (const right of ids) {
        expect(actual.areIdsConnected(left, right)).toBe(
          expected.areIdsConnected(left, right),
        )
      }
    }
    expect(prepared.getStats().cacheHitCount - before.cacheHitCount).toBe(
      expectedHit ? 1 : 0,
    )
    expect(
      prepared.getStats().constructionCount - before.constructionCount,
    ).toBe(expectedHit ? 0 : 1)
    if (expectedHit) expect(actual).toBe(previousMap)
    else expect(actual).not.toBe(previousMap)
    previousMap = actual
    return actual
  }
  const initial = compareWithNative(board, new Map(getViaPairs(board)), false)
  const initialState = structuredClone({
    netMap: initial.netMap,
    idToNetMap: initial.idToNetMap,
  })
  const checkerInput = structuredClone(board)
  for (const checker of [
    checkEachPcbTraceNonOverlapping,
    checkViaTraceClearance,
    checkPadTraceClearance,
    checkSameNetViaSpacing,
    checkDifferentNetViaSpacing,
  ]) {
    checker(checkerInput, { connMap: initial, minClearance: 0.1 })
  }
  expect({ netMap: initial.netMap, idToNetMap: initial.idToNetMap }).toEqual(
    initialState,
  )
  const moved = board.map((element): AnyCircuitElement => {
    if (element.type === "pcb_trace") {
      return {
        ...element,
        route: element.route.map((point) => ({ ...point, x: point.x + 0.1 })),
      }
    }
    if (element.type === "pcb_via") return { ...element, x: element.x + 0.2 }
    return element
  })
  compareWithNative(moved, new Map(getViaPairs(moved)), true)
  // Inferred route endpoint tags also do not affect the pinned native map.
  compareWithNative(checkerInput, new Map(getViaPairs(checkerInput)), true)
  const collidingNetLabel = initial.getNetConnectedToId("trace-b")
  if (collidingNetLabel === undefined) {
    throw new Error("Connectivity fixture requires its generated net label")
  }

  const changedDeclarations: AnyCircuitElement[][] = [
    board.map(
      (element): AnyCircuitElement =>
        element.type === "source_trace" &&
        element.source_trace_id === "source-a"
          ? { ...element, connected_source_port_ids: ["sp-a2", "sp-a"] }
          : element,
    ),
    board.map(
      (element): AnyCircuitElement =>
        element.type === "source_trace" &&
        element.source_trace_id === "source-a"
          ? { ...element, connected_source_net_ids: ["net-a2", "net-a"] }
          : element,
    ),
    board.map(
      (element): AnyCircuitElement =>
        element.type === "source_trace" &&
        element.source_trace_id === "source-a"
          ? { ...element, connected_source_net_ids: ["net-b"] }
          : element,
    ),
    board.map(
      (element): AnyCircuitElement =>
        element.type === "pcb_port" && element.pcb_port_id === "port-a"
          ? { ...element, source_port_id: "sp-b" }
          : element,
    ),
    board.map((element): AnyCircuitElement => {
      if (element.type !== "pcb_smtpad") return element
      const { pcb_port_id, ...unlinkedPad } = element
      return unlinkedPad
    }),
    board.map((element): AnyCircuitElement => {
      if (element.type !== "pcb_plated_hole") return element
      const { pcb_port_id, ...unlinkedHole } = element
      return unlinkedHole
    }),
    board.map((element): AnyCircuitElement => {
      if (element.type !== "pcb_trace") return element
      const { source_trace_id, ...unlinkedTrace } = element
      return unlinkedTrace
    }),
    board.map(
      (element): AnyCircuitElement =>
        element.type === "pcb_port" && element.pcb_port_id === "port-a"
          ? { ...element, pcb_port_id: "trace-b" }
          : element,
    ),
    board.map(
      (element): AnyCircuitElement =>
        element.type === "pcb_via" && element.pcb_via_id === "via-a"
          ? { ...element, pcb_via_id: collidingNetLabel }
          : element,
    ),
    board.map(
      (element): AnyCircuitElement =>
        element.type === "pcb_via" && element.pcb_via_id === "via-a"
          ? { ...element, pcb_via_id: `string:${collidingNetLabel}` }
          : element,
    ),
  ]
  for (const changed of changedDeclarations) {
    compareWithNative(changed, new Map(getViaPairs(changed)), false)
  }
  const reordered = [
    ...board.slice(0, 6),
    board[7]!,
    board[6]!,
    ...board.slice(8),
  ]
  const reorderedMap = compareWithNative(
    reordered,
    new Map(getViaPairs(reordered)),
    false,
  )
  expect(initial.getNetConnectedToId("via-a")).toBeDefined()
  expect(reorderedMap.getNetConnectedToId("via-a")).toBeDefined()
  expect(reorderedMap.getNetConnectedToId("via-a")).not.toBe(
    initial.getNetConnectedToId("via-a"),
  )
  const firstVia = board.find((element) => element.type === "pcb_via")
  if (!firstVia) throw new Error("Connectivity fixture requires its first via")
  const duplicateViaBoard = [
    ...board,
    { ...firstVia, pcb_trace_id: "trace-b", x: 0.5 },
  ]
  const duplicatePairs = getViaPairs(duplicateViaBoard)
  const snapshotMap = compareWithNative(
    duplicateViaBoard,
    new Map(duplicatePairs),
    false,
  )
  expect(snapshotMap.areIdsConnected("trace-a", "trace-b")).toBe(false)
  expect(snapshotMap.areIdsConnected("via-a", "trace-b")).toBe(true)
  const fullDrcMap = compareWithNative(duplicateViaBoard, duplicatePairs, false)
  expect(fullDrcMap.areIdsConnected("trace-a", "trace-b")).toBe(true)
  compareWithNative(duplicateViaBoard, [...duplicatePairs].reverse(), false)
  // Malformed external via ids are not filtered by the existing owner-link
  // extraction. Preserve native undefined/null distinctions without validation.
  for (const invalidId of [undefined, null]) {
    const malformed = board.map((element): AnyCircuitElement => {
      if (element.type !== "pcb_via" || element.pcb_via_id !== "via-a") {
        return element
      }
      return {
        ...element,
        pcb_via_id: invalidId,
      } as unknown as AnyCircuitElement
    })
    const malformedMap = compareWithNative(
      malformed,
      getViaPairs(malformed),
      false,
    )
    expect(malformedMap.getNetConnectedToId(String(invalidId))).toBeDefined()
  }
  // A single-entry cache rebuilds after another key; older maps stay unchanged.
  compareWithNative(board, new Map(getViaPairs(board)), false)
  expect({ netMap: initial.netMap, idToNetMap: initial.idToNetMap }).toEqual(
    initialState,
  )
  expect(board).toEqual(original)
})
