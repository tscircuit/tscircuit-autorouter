import { describe, expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "../../../lib"
import type { SimpleRouteJson } from "../../../lib/types"

describe("port IDs in output", () => {
  test("output traces should include start_pcb_port_id and end_pcb_port_id on wire segments", () => {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          connectedTo: ["connection_0"],
        },
        {
          type: "rect",
          layers: ["top"],
          center: { x: 5, y: 0 },
          width: 1,
          height: 1,
          connectedTo: ["connection_0"],
        },
      ],
      connections: [
        {
          name: "connection_0",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_start" },
            { x: 5, y: 0, layer: "top", pcb_port_id: "pcb_port_end" },
          ],
        },
      ],
      bounds: { minX: -5, maxX: 10, minY: -5, maxY: 5 },
    }

    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const traces = solver.getOutputSimplifiedPcbTraces()
    expect(traces.length).toBeGreaterThan(0)

    // Find the trace for our connection
    const trace = traces.find((t) => t.connection_name === "connection_0")
    expect(trace).toBeDefined()

    // Get wire segments only
    const wireSegments = trace!.route.filter((s) => s.route_type === "wire")
    expect(wireSegments.length).toBeGreaterThan(0)

    // First wire segment should have start_pcb_port_id
    const firstWire = wireSegments[0]
    expect(firstWire).toHaveProperty("start_pcb_port_id", "pcb_port_start")

    // Last wire segment should have end_pcb_port_id
    const lastWire = wireSegments[wireSegments.length - 1]
    expect(lastWire).toHaveProperty("end_pcb_port_id", "pcb_port_end")
  })

  test("getOutputSimpleRouteJson includes port IDs in traces", () => {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          connectedTo: ["net_1"],
        },
        {
          type: "rect",
          layers: ["top"],
          center: { x: 3, y: 3 },
          width: 1,
          height: 1,
          connectedTo: ["net_1"],
        },
      ],
      connections: [
        {
          name: "net_1",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top", pcb_port_id: "port_A" },
            { x: 3, y: 3, layer: "top", pcb_port_id: "port_B" },
          ],
        },
      ],
      bounds: { minX: -5, maxX: 10, minY: -5, maxY: 10 },
    }

    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()

    const outputSrj = solver.getOutputSimpleRouteJson()
    expect(outputSrj.traces).toBeDefined()
    expect(outputSrj.traces!.length).toBeGreaterThan(0)

    const trace = outputSrj.traces![0]
    const wireSegments = trace.route.filter((s) => s.route_type === "wire")

    // Verify port IDs are present
    const firstWire = wireSegments[0]
    const lastWire = wireSegments[wireSegments.length - 1]

    if (firstWire.route_type === "wire") {
      expect(firstWire.start_pcb_port_id).toBe("port_A")
    }
    if (lastWire.route_type === "wire") {
      expect(lastWire.end_pcb_port_id).toBe("port_B")
    }
  })
})
