import { expect, test } from "bun:test"
import { canPublishPartialFixedObstacleRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canPublishPartialFixedObstacleRepair"
import type { SimpleRouteJson } from "lib/types"

test("partial publication recognizes generated pads and fragments without accepting holes or vias", (): void => {
  const pad = {
    type: "rect" as const,
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: ["terminal"],
    circuitJsonMetadata: { pcb_smtpad_id: "physical_pad" },
  }
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: [
      {
        name: "terminal",
        pointsToConnect: [{ x: 2, y: 0, layer: "top", pcb_port_id: "port" }],
      },
    ],
    obstacles: [
      pad,
      { ...pad, width: 2 },
      pad,
      {
        ...pad,
        center: { x: 2, y: 0 },
        circuitJsonMetadata: { pcb_port_id: "port" },
      },
      {
        ...pad,
        layers: ["top", "bottom"],
        circuitJsonMetadata: { pcb_port_id: "port" },
      },
      { ...pad, isNonPlatedHole: true, obstacleId: "hole" },
      { ...pad, circuitJsonMetadata: { pcb_via_id: "existing_via" } },
    ],
  }
  const validPadIds = [
    "physical_pad",
    "physical_pad_fragment_1",
    "pcb_smtpad_2.000_0.000",
    "pcb_plated_hole_0.000_0.000",
  ]
  const invalidPadIds = [
    "physical_pad_fragment_2",
    "hole",
    "existing_via",
    "unknown",
  ]
  for (const padId of [...validPadIds, ...invalidPadIds]) {
    const residue = {
      type: "pcb_pad_pad_clearance_error",
      pcb_trace_id: "signal_0",
      pcb_via_ids: ["signal_via"],
      pcb_pad_ids: ["signal_via", padId],
      minimum_clearance: 0.1,
      actual_clearance: 0.05,
    }
    expect(
      canPublishPartialFixedObstacleRepair({
        originalSrj,
        initialErrors: [
          residue,
          { type: "pcb_trace_error", pcb_trace_id: "other_0" },
        ],
        remainingErrors: [residue],
      }),
    ).toBe(validPadIds.includes(padId))
  }
})
