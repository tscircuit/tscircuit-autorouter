import { expect, test } from "bun:test"
import { resolvePipeline9PadAreaTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PadAreaTerminals"
import { createPipeline9PadAreaTerminalInput } from "./fixtures/createPipeline9PadAreaTerminalInput"

test("every occurrence of one PCB terminal receives one landing without changing source copper or identities", (): void => {
  const originalSrj = createPipeline9PadAreaTerminalInput()
  originalSrj.connections.push({
    name: "another-pair",
    nominalTraceWidth: 0.25,
    pointsToConnect: [
      {
        ...originalSrj.connections[0]!.pointsToConnect[0]!,
        pointId: "logical-a-copy",
      },
      { x: -2, y: 1, layer: "top", pcb_port_id: "pcb-c", pointId: "logical-c" },
    ],
  })
  originalSrj.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "unrelated-source-copper",
      connection_name: "unrelated-net",
      connectsTo: ["pcb-x", "pcb-y"],
      route: [
        { route_type: "wire", x: -3, y: -2, width: 0.25, layer: "top" },
        { route_type: "wire", x: -2, y: -2, width: 0.25, layer: "top" },
      ],
    },
  ]
  const routingSrj = structuredClone(originalSrj)
  const originalBefore = structuredClone(originalSrj)
  const routingBefore = structuredClone(routingSrj)
  const result = resolvePipeline9PadAreaTerminals({ originalSrj, routingSrj })
  expect(result).not.toBe(routingSrj)
  expect(result.obstacles).toBe(routingSrj.obstacles)
  expect(result.traces).toBe(routingSrj.traces)
  expect(result.connections.map((connection): string => connection.name)).toEqual([
    "net-a",
    "another-pair",
  ])
  const first = result.connections[0]!.pointsToConnect[0]!
  const second = result.connections[1]!.pointsToConnect[0]!
  expect(first.x).toBeCloseTo(0.63, 12)
  expect(first.y).toBe(0)
  expect({ x: second.x, y: second.y }).toEqual({ x: first.x, y: first.y })
  expect(first.pointId).toBe("logical-a")
  expect(second.pointId).toBe("logical-a-copy")
  for (const [index, connection] of result.connections.entries()) {
    const landing = connection.pointsToConnect[0]!
    expect(landing.pcb_port_id).toBe("pcb-a")
    expect("layer" in landing && landing.layer).toBe("top")
    expect(connection.nominalTraceWidth).toBe(0.25)
    expect(connection.pointsToConnect[1]).toBe(
      routingSrj.connections[index]!.pointsToConnect[1],
    )
  }
  expect(originalSrj).toEqual(originalBefore)
  expect(routingSrj).toEqual(routingBefore)
})
