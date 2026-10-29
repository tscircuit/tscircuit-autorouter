import { expect, test } from "bun:test"
import { checkViaPadClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbVia } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createViaPadClearanceEvaluator } from "lib/utils/autorouting-drc/createViaPadClearanceEvaluator"

const referenceErrors = (
  circuitJson: AnyCircuitElement[],
  connMap: ConnectivityMap,
  minClearance?: number,
): Record<string, unknown>[] => {
  const vias = circuitJson.filter((element) => element.type === "pcb_via")
  const viasById = new Map(vias.map((via) => [via.pcb_via_id, via]))
  return checkViaPadClearance(circuitJson, { connMap, minClearance }).map(
    (error) => {
      const viaIds = error.pcb_pad_ids.filter((id) => viasById.has(id))
      const via = viasById.get(viaIds[0]!)
      return {
        ...error,
        pcb_via_ids: viaIds,
        ...(via?.pcb_trace_id ? { pcb_trace_id: via.pcb_trace_id } : {}),
      }
    },
  )
}

test("native via pad clearance preserves geometry, discovery order, and movable ownership", () => {
  const staticCircuitJson: AnyCircuitElement[] = [
    {
      type: "pcb_board",
      pcb_board_id: "board",
      center: { x: 6, y: 0 },
      width: 20,
      height: 10,
      thickness: 1.6,
      num_layers: 2,
      material: "fr4",
      min_pad_edge_to_pad_edge_clearance: 0.15,
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "circle",
      shape: "circle",
      x: 0,
      y: 0,
      radius: 0.4,
      layer: "top",
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "rect",
      shape: "rect",
      x: 3,
      y: 0,
      width: 1,
      height: 0.5,
      layer: "top",
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "rotated",
      shape: "rotated_rect",
      x: 6,
      y: 0,
      width: 1.4,
      height: 0.4,
      ccw_rotation: 45,
      layer: "top",
    },
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "round_hole",
      shape: "circle",
      x: 9,
      y: 0,
      outer_diameter: 0.8,
      hole_diameter: 0.3,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "rect_hole",
      shape: "rotated_pill_hole_with_rect_pad",
      hole_shape: "rotated_pill",
      pad_shape: "rect",
      x: 12,
      y: 0,
      rect_pad_width: 1,
      rect_pad_height: 0.5,
      rect_ccw_rotation: 30,
      hole_width: 0.2,
      hole_height: 0.2,
      hole_ccw_rotation: 30,
      hole_offset_x: 0,
      hole_offset_y: 0,
      layers: ["top", "bottom"],
    },
    ...Array.from(
      { length: 12 },
      (_, index): AnyCircuitElement => ({
        type: "pcb_smtpad",
        pcb_smtpad_id: `cluster_${index}`,
        shape: "rect",
        x: (index - 6) * 0.03,
        y: 3,
        width: 0.1,
        height: 0.1,
        layer: "top",
      }),
    ),
  ]
  const vias: PcbVia[] = [
    [0.5, 0],
    [3.68, 0],
    [6.4, 0.4],
    [9.58, 0],
    [12.4, 0.3],
    [0.1, 3],
  ].map(([x, y], index) => ({
    type: "pcb_via",
    pcb_via_id: `via_${index}`,
    pcb_trace_id: `trace_${index}`,
    x: x!,
    y: y!,
    outer_diameter: 0.3,
    hole_diameter: 0.15,
    layers: ["top", "bottom"],
  }))
  const connMap = new ConnectivityMap({})
  const circuitJson = [...staticCircuitJson, ...vias]
  const evaluate = createViaPadClearanceEvaluator(staticCircuitJson)
  const reference = referenceErrors(circuitJson, connMap)
  const actual = evaluate(circuitJson, connMap)
  expect(reference.length).toBeGreaterThan(12)
  expect(actual[0]).toMatchObject({
    pcb_pad_pad_clearance_error_id: "via_pad_clearance_via_0_circle",
    pcb_via_ids: ["via_0"],
    pcb_trace_id: "trace_0",
  })
  expect(actual).toEqual(reference)

  connMap.addConnections([["via_0", "circle"]])
  expect(evaluate(circuitJson, connMap)).toEqual(
    referenceErrors(circuitJson, connMap),
  )
  expect(
    evaluate(circuitJson, connMap).some(
      (error) =>
        error.pcb_pad_pad_clearance_error_id ===
        "via_pad_clearance_via_0_circle",
    ),
  ).toBeFalse()
  const override = createViaPadClearanceEvaluator(staticCircuitJson, {
    minClearance: 0.02,
  })
  expect(override(circuitJson, connMap)).toEqual(
    referenceErrors(circuitJson, connMap, 0.02),
  )

  const separated = [
    ...staticCircuitJson,
    ...vias.map((via) => ({ ...via, y: 8 })),
  ]
  expect(referenceErrors(separated, connMap)).toHaveLength(0)
  expect(evaluate(separated, connMap)).toHaveLength(0)
  expect(evaluate(circuitJson, connMap)).toEqual(
    referenceErrors(circuitJson, connMap),
  )
})
