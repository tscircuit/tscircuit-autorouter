import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9LayerAwareNetToPointPairsSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LayerAwareNetToPointPairsSolver"
import { NetToPointPairsSolver } from "../../lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "../../lib/types/srj-types"

test("layer-aware point pairs retain co-located opposite pads and preloaded connectivity", (): void => {
  const scenario: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [],
    connections: [{ name: "signal", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pointId: "top-pad", pcb_port_id: "top-port" },
      { x: 0, y: 0, layer: "bottom", pointId: "bottom-pad", pcb_port_id: "bottom-port" },
      { x: 1, y: 0, layer: "top", pointId: "destination" },
    ] }],
  }
  const original = new NetToPointPairsSolver(scenario, {}, new ConnectivityMap({}))
  const corrected = new Pipeline9LayerAwareNetToPointPairsSolver(scenario, {}, new ConnectivityMap({}))
  original.solve()
  corrected.solve()
  expect(original.newConnections).toHaveLength(1)
  expect(corrected.newConnections).toHaveLength(2)
  expect(corrected.newConnections.some((connection) =>
    connection.pointsToConnect[0]!.pcb_port_id === "top-port" &&
    connection.pointsToConnect[1]!.pcb_port_id === "bottom-port",
  )).toBe(true)
  expect(corrected.newConnections.every((connection) =>
    connection.__rootConnectionNames?.includes("signal"),
  )).toBe(true)
  const preconnected = new Pipeline9LayerAwareNetToPointPairsSolver(
    scenario, {}, new ConnectivityMap({ existingVia: ["top-pad", "bottom-pad"] }),
  )
  preconnected.solve()
  expect(preconnected.newConnections).toHaveLength(1)
  expect(preconnected.newConnections[0]!.pointsToConnect.some((point) => point.pointId === "destination")).toBe(true)
  const ordinaryScenario = structuredClone(scenario)
  ordinaryScenario.connections[0]!.pointsToConnect[1]!.x = -1
  const ordinary = new NetToPointPairsSolver(ordinaryScenario, {}, new ConnectivityMap({}))
  const ordinaryCorrected = new Pipeline9LayerAwareNetToPointPairsSolver(ordinaryScenario, {}, new ConnectivityMap({}))
  ordinary.solve()
  ordinaryCorrected.solve()
  expect(ordinaryCorrected.newConnections).toEqual(ordinary.newConnections)
  expect(ordinaryScenario.connections[0]!.pointsToConnect.map((point) => point.x)).toEqual([0, -1, 1])
})
