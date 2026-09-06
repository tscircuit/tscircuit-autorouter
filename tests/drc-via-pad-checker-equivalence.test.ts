import { checkViasInPads } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { ownedViaAndPad } from "./fixtures/ownedViaAndPad"

type ViaPadError = ReturnType<typeof checkViasInPads>[number]

test("adding via centers preserves the original checker errors and order across overlapping pads", (): void => {
  const circuitJson = ownedViaAndPad(0)
  const via = circuitJson.find(
    (element): element is Extract<AnyCircuitElement, { type: "pcb_via" }> =>
      element.type === "pcb_via",
  )!
  const pad = circuitJson.find(
    (
      element,
    ): element is Extract<
      AnyCircuitElement,
      { type: "pcb_smtpad"; shape: "rect" }
    > => element.type === "pcb_smtpad" && element.shape === "rect",
  )!
  const board = {
    type: "pcb_board" as const,
    pcb_board_id: "board",
    center: { x: 0, y: 0 },
    width: 20,
    height: 20,
    thickness: 1.6,
    material: "fr4" as const,
    num_layers: 2,
    is_via_in_pad_allowed: false,
  }
  // Interleave vias and pads to exercise the checker's original iteration and
  // pad-label ordering. A top-only via over the bottom pad is a negative case.
  circuitJson.push(
    board,
    { ...pad, pcb_smtpad_id: "pad_b", x: 0.1, y: 0.1 },
    { ...via, pcb_via_id: "via_b", x: 0.2, y: 0 },
    { ...via, pcb_via_id: "via_top", x: 2, y: 2, layers: ["top"] },
    { ...pad, pcb_smtpad_id: "pad_bottom", x: 2, y: 2, layer: "bottom" },
    { ...via, pcb_via_id: "via_bottom", x: 2, y: 2, layers: ["bottom"] },
  )
  const expected = checkViasInPads(circuitJson)
  expect(expected).toHaveLength(5)
  const options = { includeViaPadChecks: true, includeTraceContinuity: false }
  const actual = getDrcErrors(circuitJson, options).errorsWithCenters.filter(
    (error): error is ViaPadError & { center?: { x: number; y: number } } =>
      error.type === "pcb_placement_error",
  )
  const withoutCenters = actual.map(
    ({ center: _center, ...error }): ViaPadError => error,
  )
  expect(withoutCenters).toEqual(expected)
  expect(actual.map((error): typeof error.center => error.center)).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0.2, y: 0 },
    { x: 0.2, y: 0 },
    { x: 2, y: 2 },
  ])

  board.is_via_in_pad_allowed = true
  expect(checkViasInPads(circuitJson)).toEqual([])
  expect(
    getDrcErrors(circuitJson, options).errors.filter(
      (error): boolean => error.type === "pcb_placement_error",
    ),
  ).toEqual([])
})
