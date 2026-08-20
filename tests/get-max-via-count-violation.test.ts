import { expect, test } from "bun:test"
import type {
  SimpleRouteConnection,
  SimplifiedPcbTraces,
} from "lib/types"
import { getMaxViaCountViolation } from "lib/utils/get-max-via-count-violation"

test("detects a via violation on a merged root connection", () => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "XTAL_OUT",
      maxViaCount: 0,
      pointsToConnect: [],
    },
    {
      name: "XTAL_LOAD_OUT",
      maxViaCount: 0,
      pointsToConnect: [],
    },
  ]
  const routedConnections: SimpleRouteConnection[] = [
    {
      name: "XTAL_OUT__XTAL_LOAD_OUT_mst0",
      __rootConnectionNames: ["XTAL_OUT", "XTAL_LOAD_OUT"],
      pointsToConnect: [],
    },
  ]
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "XTAL_OUT__XTAL_LOAD_OUT_mst0_0",
      connection_name: "XTAL_OUT",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 1,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
        },
      ],
    },
  ]

  expect(
    getMaxViaCountViolation({
      connections,
      routedConnections,
      traces,
    }),
  ).toEqual({
    connectionName: "XTAL_OUT",
    actualViaCount: 1,
    maxViaCount: 0,
  })
})
