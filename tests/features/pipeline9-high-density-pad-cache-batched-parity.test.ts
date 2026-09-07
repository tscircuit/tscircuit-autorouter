import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreparedPadTraceClearanceChecker } from "lib/testing/utils/createPreparedPadTraceClearanceChecker"

test("prepared pad checks batch changed traces and retain native order, contact suppression and private errors", (): void => {
  const createTrace = (id: string, y: number): PcbTrace => ({
    type: "pcb_trace",
    pcb_trace_id: id,
    route: [-1, 0, 1].map((x): PcbTrace["route"][number] => ({
      route_type: "wire" as const,
      x,
      y,
      width: 0.1,
      layer: "top" as const,
    })),
  })
  const first = createTrace("first", 0)
  const second = createTrace("second", 3)
  const contact = createTrace("contact", 6)
  contact.route.push(
    { route_type: "wire", x: 1, y: 6.18, width: 0.1, layer: "top" },
    { route_type: "wire", x: -1, y: 6.18, width: 0.1, layer: "top" },
  )
  const board: AnyCircuitElement[] = [
    first,
    second,
    contact,
    ...[0, 3, 6].map(
      (y, index): AnyCircuitElement => ({
        type: "pcb_smtpad",
        pcb_smtpad_id: `pad-${index}`,
        x: 0,
        y: y + 0.22,
        shape: "circle",
        radius: 0.1,
        layer: "top",
      }),
    ),
  ]
  const original = structuredClone(board)
  const options = { connMap: new ConnectivityMap({}), minClearance: 0.1 }
  const prepared = createPreparedPadTraceClearanceChecker()
  const firstErrors = prepared(board, options)
  expect(firstErrors).toEqual(checkPadTraceClearance(board, options))
  expect(firstErrors.map((error): string => error.pcb_trace_id)).toEqual([
    "first",
    "second",
  ])
  expect(prepared.getStats()).toEqual({
    evaluationCount: 1,
    nativeInvocationCount: 1,
    evaluatedTraceCount: 3,
    cacheHitTraceCount: 0,
  })
  firstErrors[0]!.message = "Caller mutated the error"
  firstErrors[0]!.center!.x = 999
  firstErrors.reverse()
  const changedBoard = board.map((element): AnyCircuitElement => {
    if (element !== first) return element
    return {
      ...first,
      route: first.route.map((point, index): PcbTrace["route"][number] => {
        if (point.route_type !== "wire") {
          throw new Error("The changed fixture trace requires wire points")
        }
        return { ...point, y: index === 1 ? -0.03 : point.y }
      }),
    }
  })
  expect(prepared(changedBoard, options)).toEqual(
    checkPadTraceClearance(changedBoard, options),
  )
  expect(prepared.getStats()).toEqual({
    evaluationCount: 2,
    nativeInvocationCount: 2,
    evaluatedTraceCount: 4,
    cacheHitTraceCount: 2,
  })
  // Fresh mutable copies still represent exactly the same checked geometry.
  expect(prepared(structuredClone(changedBoard), options)).toEqual(
    checkPadTraceClearance(changedBoard, options),
  )
  expect(prepared.getStats().nativeInvocationCount).toBe(2)
  expect(prepared.getStats().cacheHitTraceCount).toBe(5)
  expect(board).toEqual(original)

  // A same-object geometry edit cannot masquerade as an immutable cache hit.
  const changedPoint = second.route[1]!
  if (changedPoint.route_type !== "wire") {
    throw new Error("The fixture mutation requires a wire point")
  }
  changedPoint.y -= 0.02
  expect(prepared(changedBoard, options)).toEqual(
    checkPadTraceClearance(changedBoard, options),
  )
  expect(prepared.getStats().evaluatedTraceCount).toBe(5)
  const splitBoard = changedBoard.flatMap((element): AnyCircuitElement[] =>
    element.type === "pcb_trace" && element.pcb_trace_id === "first"
      ? [
          { ...element, route: element.route.slice(0, 2) },
          {
            ...element,
            pcb_trace_id: "first-fragment",
            route: element.route.slice(1),
          },
        ]
      : [element],
  )
  for (const nextBoard of [
    splitBoard,
    [...splitBoard].reverse(),
    changedBoard,
  ]) {
    expect(prepared(nextBoard, options)).toEqual(
      checkPadTraceClearance(nextBoard, options),
    )
  }
})
