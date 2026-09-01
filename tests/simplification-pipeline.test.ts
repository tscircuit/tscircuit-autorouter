import { expect, test } from "bun:test"
import { SimplificationPipelineSolver } from "lib/autorouter-pipelines/SimplificationPipeline/SimplificationPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

test("simplification pipeline cleans existing traces without routing SRJ connections", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.4,
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "pcb_port_2" },
        ],
      },
      {
        name: "unrouted",
        pointsToConnect: [
          { x: 0, y: 3, layer: "top" },
          { x: 4, y: 3, layer: "top" },
        ],
      },
    ],
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 4 },
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "pcb_trace_signal",
        connection_name: "signal",
        connectsTo: ["pcb_port_1", "pcb_port_2"],
        route: [
          {
            route_type: "wire",
            x: 0,
            y: 0,
            width: 0.15,
            layer: "top",
            start_pcb_port_id: "pcb_port_1",
          },
          { route_type: "wire", x: 1, y: 1, width: 0.15, layer: "top" },
          { route_type: "wire", x: 2, y: 1.5, width: 0.15, layer: "top" },
          { route_type: "wire", x: 3, y: 1, width: 0.15, layer: "top" },
          {
            route_type: "wire",
            x: 4,
            y: 0,
            width: 0.15,
            layer: "top",
            end_pcb_port_id: "pcb_port_2",
          },
        ],
      },
    ],
  }
  const inputSnapshot = structuredClone(input)
  const solver = new SimplificationPipelineSolver(input, { iterations: 1 })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(input).toEqual(inputSnapshot)
  const output = solver.getOutputSimpleRouteJson()
  expect(output.connections).toEqual(input.connections)
  expect(output.traces).toHaveLength(1)
  expect(output.traces?.[0]).toMatchObject({
    pcb_trace_id: "pcb_trace_signal",
    connection_name: "signal",
    connectsTo: ["pcb_port_1", "pcb_port_2"],
  })
  const wires = output.traces![0]!.route.filter(
    (point) => point.route_type === "wire",
  )
  expect(wires.length).toBeLessThan(input.traces![0]!.route.length)
  expect(wires[0]).toMatchObject({
    x: 0,
    y: 0,
    layer: "top",
    start_pcb_port_id: "pcb_port_1",
  })
  expect(wires.at(-1)).toMatchObject({
    x: 4,
    y: 0,
    layer: "top",
    end_pcb_port_id: "pcb_port_2",
  })
  expect(
    output.traces?.some((trace) => trace.connection_name === "unrouted"),
  ).toBe(false)
})
