import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("BUG: Pipeline9 routes J1 directly to MCU with ESD on a branch before rejecting lost pair names", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, { cacheProvider: null })
  expect(() => solver.solve()).toThrow('differential pair connection "P:0" must resolve to exactly one final point-pair connection, got 3')
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  const traces = solver.getNewTracesBeforePowerExpansion()
  expect(traces).toHaveLength(5)
  for (const polarity of ["P", "N"]) {
    const firstHop = srj.connections.find((connection) => connection.name === `${polarity}:0`)!
    const secondHop = srj.connections.find((connection) => connection.name === `${polarity}:1`)!
    const [j1, esd] = firstHop.pointsToConnect
    const mcu = secondHop.pointsToConnect[1]
    const shortcut = traces.find((trace) =>
      trace.connectsTo?.includes(j1.pcb_port_id!) && trace.connectsTo.includes(mcu.pcb_port_id!),
    )!
    expect(shortcut.route).toHaveLength(2)
    const wires = shortcut.route.filter((point) => point.route_type === "wire")
    expect(wires).toHaveLength(2)
    expect(wires.map((point) => ({ x: point.x, y: point.y }))).toEqual([
      { x: mcu.x, y: mcu.y }, { x: j1.x, y: j1.y },
    ])
    expect(Math.min(...wires.map((point) => Math.hypot(point.x - esd.x, point.y - esd.y)))).toBeGreaterThan(7)
    expect(traces.some((trace) => trace.connection_name === `${polarity}:1`)).toBe(false)
  }
  // Snapshot real routed copper immediately before the failing matching stage,
  // not a successful final result. Flip to a solved pipeline and preserved
  // J1->ESD / ESD->MCU hop geometry when ordered ownership is implemented.
  const graphics: GraphicsObject = convertSrjToGraphicsObject({
    ...srj,
    traces,
  })
  graphics.points = srj.connections.flatMap((connection) => connection.pointsToConnect.map((point) => ({ ...point, label: point.port_selector, color: "black" })))
  graphics.texts = [
    { x: 0, y: 4.2, text: "Expected: J1 -> ESD -> MCU; ESD -> TP is a tap", fontSize: 0.32 },
    { x: 0, y: 3.4, text: "BUG: J1 -> MCU -> ESD; pair matching then rejects lost hop names", fontSize: 0.28 },
    { x: -5, y: -1.5, text: "J1.DP", fontSize: 0.3 },
    { x: -3, y: -1.5, text: "MCU.DP", fontSize: 0.3 },
    { x: 5, y: -1.5, text: "ESD.DP", fontSize: 0.3 },
    { x: -5, y: -4.5, text: "J1.DM", fontSize: 0.3 },
    { x: -3, y: -4.5, text: "MCU.DM", fontSize: 0.3 },
    { x: 5, y: -4.5, text: "ESD.DM", fontSize: 0.3 },
    { x: 5, y: 2.4, text: "TP.DP", fontSize: 0.3 },
    { x: 0, y: -5.5, text: "Actual routed copper before matching failure, not successful final output", fontSize: 0.25 },
  ]
  await expect(getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })).toMatchSvgSnapshot(import.meta.path)
})
