import { expect, test } from "bun:test"
import { checkViaPadClearance } from "@tscircuit/checks"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { createCoreDrcViaSpanFixture } from "tests/fixtures/core-drc-via-span-fixture"

test("reference DRC includes Core's via-pad checker and declared pad-edge clearance", () => {
  const fixture = createCoreDrcViaSpanFixture({
    allowBlindAndBuriedVias: false,
  })
  const srj: SimpleRouteJson = {
    ...fixture.srj,
    minPadEdgeToPadEdgeClearance: 0.25,
    obstacles: [
      ...fixture.srj.obstacles.filter((obstacle) =>
        obstacle.connectedTo.includes("VCC"),
      ),
      {
        type: "rect",
        center: { x: 0.5, y: 0 },
        width: 0.2,
        height: 0.2,
        layers: ["bottom"],
        connectedTo: [],
        circuitJsonMetadata: { pcb_smtpad_id: "other_net_pad" },
      },
    ],
    connections: fixture.srj.connections.filter(
      (connection) => connection.name === "via_connection",
    ),
  }
  const traces = fixture.traces.filter(
    (trace) => trace.connection_name === "via_connection",
  )
  const result = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: traces,
    includeBoardClearance: true,
  })
  const board = result.circuitJson.find(
    (element) => element.type === "pcb_board",
  )
  expect(board?.min_pad_edge_to_pad_edge_clearance).toBe(0.25)
  const coreErrors = checkViaPadClearance(result.circuitJson)
  expect(coreErrors).toHaveLength(1)
  expect(coreErrors[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    pcb_pad_ids: ["via_0", "other_net_pad"],
    minimum_clearance: 0.25,
  })
  expect(result.errors).toEqual(coreErrors)
})
