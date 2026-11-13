import { expect, test } from "bun:test"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { existingPlaneVias } from "tests/fixtures/existing-plane-vias"

test("existing plane access requires physical connectivity, layer reach and the same plane region", (): void => {
  const scenarios = [
    "missing vias",
    "one existing via",
    "wrong net",
    "non-plated holes",
    "blind vias miss plane",
    "vias outside plane",
    "separate plane islands",
    "coincident GND trace vias",
    "coincident net-only trace vias",
    "coincident net-only aliased trace vias",
    "coincident net-only wrong-net trace vias",
    "connected remote trace vias",
    "chained remote trace vias",
    "externally connected remote trace vias",
    "unconnected remote same-net vias",
    "blind trace vias miss plane",
    "through trace vias reach inner4",
    "explicit trace span reaches inner4",
    "merged connections",
  ]

  for (const scenario of scenarios) {
    const input = structuredClone(existingPlaneVias)
    const plane = input.obstacles[0]!
    let connected = false
    if (scenario === "missing vias") input.obstacles = [plane]
    if (scenario === "one existing via") input.obstacles.pop()
    if (scenario === "wrong net") {
      for (const via of input.obstacles.slice(1)) via.connectedTo = ["VCC"]
    }
    if (scenario === "non-plated holes") {
      for (const via of input.obstacles.slice(1)) {
        via.isNonPlatedHole = true
        via.connectedTo = []
      }
    }
    if (scenario === "blind vias miss plane") {
      for (const via of input.obstacles.slice(1)) {
        via.layers = ["inner3", "inner4", "bottom"]
      }
    }
    if (scenario === "vias outside plane") {
      plane.center.y = 1.5
      plane.height = 0.5
    }
    if (scenario === "separate plane islands") {
      plane.center.x = -1
      plane.width = 0.8
      input.obstacles.push({ ...plane, center: { x: 1, y: 0 } })
    }
    if (
      scenario.includes("trace") ||
      scenario === "unconnected remote same-net vias"
    ) {
      input.obstacles = [plane]
      const remote = scenario.includes("remote")
      const unconnected = scenario === "unconnected remote same-net vias"
      const chained = scenario === "chained remote trace vias"
      const external = scenario === "externally connected remote trace vias"
      const startsAtRemotePoint = unconnected || chained || external
      const netOnly = scenario.includes("net-only")
      const wrongNet = scenario.includes("wrong-net")
      const aliased = scenario.includes("aliased")
      const blind = scenario === "blind trace vias miss plane"
      const explicitSpan = scenario === "explicit trace span reaches inner4"
      input.allowBlindAndBuriedVias = blind || explicitSpan
      if (scenario.includes("inner4")) plane.layers = ["inner4"]
      if (aliased) {
        input.connections[0]!.__rootConnectionNames = ["GND", "GND_ALIAS"]
      }
      input.traces = input.connections[0]!.pointsToConnect.map((point) => ({
        type: "pcb_trace",
        pcb_trace_id: `existing-${point.pointId}`,
        connection_name: wrongNet ? "VCC" : aliased ? "GND_ALIAS" : "GND",
        connectsTo: netOnly
          ? []
          : [startsAtRemotePoint ? `remote-${point.pointId}` : point.pointId!],
        isFixed: true,
        route: [
          {
            route_type: "wire",
            x: point.x,
            y: startsAtRemotePoint ? 0.4 : 0,
            layer: "inner3",
            width: 0.15,
          },
          {
            route_type: "wire",
            x: point.x,
            y: remote ? 0.8 : 0,
            layer: "inner3",
            width: 0.15,
          },
          {
            route_type: "via",
            x: point.x,
            y: remote ? 0.8 : 0,
            from_layer: "inner3",
            to_layer: blind ? "bottom" : "top",
            ...(explicitSpan
              ? {
                  layers: [
                    "top",
                    "inner1",
                    "inner2",
                    "inner3",
                    "inner4",
                    "bottom",
                  ],
                }
              : {}),
            via_diameter: 0.3,
            via_hole_diameter: 0.15,
          },
        ],
      }))
      if (chained) {
        for (const point of input.connections[0]!.pointsToConnect) {
          input.traces.push({
            type: "pcb_trace",
            pcb_trace_id: `link-${point.pointId}`,
            connection_name: "GND",
            connectsTo: [point.pointId!, `remote-${point.pointId}`],
            isFixed: true,
            route: [
              {
                route_type: "wire",
                x: point.x,
                y: point.y,
                layer: "inner3",
                width: 0.15,
              },
              {
                route_type: "wire",
                x: point.x,
                y: 0.4,
                layer: "inner3",
                width: 0.15,
              },
            ],
          })
        }
      }
      if (external) {
        const connection = input.connections[0]!
        connection.externallyConnectedPointIds = connection.pointsToConnect.map(
          (point) => [point.pointId!, `remote-${point.pointId}`],
        )
      }
      connected = !unconnected && !blind && !wrongNet
    }
    if (scenario === "merged connections") {
      input.connections.push({
        name: "ground-branch",
        pointsToConnect: input.connections[0]!.pointsToConnect,
      })
      connected = true
    }

    const original = structuredClone(input)
    const escape = new EscapeViaLocationSolver(input)
    escape.solve()
    expect(escape.solved).toBeTrue()
    const output = escape.getOutputSimpleRouteJson()
    const pairs = new NetToPointPairsSolver2_OffBoardConnection(
      output,
      {},
      getInitiallyConnectedMapFromSimpleRouteJson(output),
    )
    pairs.solve()
    expect(pairs.solved).toBeTrue()
    expect(input).toEqual(original)
    expect(output.traces).toEqual(original.traces)
    expect(pairs.newConnections.length === 0).toBe(connected)
    if (connected || scenario === "separate plane islands") {
      expect(escape.createdEscapeVias).toHaveLength(0)
    }
    if (scenario === "one existing via") {
      expect(escape.createdEscapeVias).toHaveLength(1)
      expect(pairs.newConnections).toHaveLength(1)
    }
    if (scenario === "missing vias") {
      expect(escape.createdEscapeVias).toHaveLength(2)
      expect(pairs.newConnections).toHaveLength(2)
    }
  }
})
