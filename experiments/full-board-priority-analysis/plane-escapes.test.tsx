import { expect, test } from "bun:test"
import { RootCircuit, SOLVERS } from "./core-runtime.mjs"
import { NativeFullBoard } from "./native-full-board"
import { createPlaneTestSource } from "./plane-test-source"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./runtime.mjs"
import { arePortsConnected } from "./connectivity"

test("full-board plane phase retains both terminals and joins them through freshly generated copper", async () => {
  Object.assign(SOLVERS, { AutoroutingPipelineSolver9_PreloadedTraceGraph })
  const source = createPlaneTestSource([[{x:-6,y:-3},{x:6,y:-3},{x:6,y:3},{x:-6,y:3}]])
  const circuit = new RootCircuit()
  const inputs: any[] = []
  circuit.on("autorouting:start", (event) => inputs.push(event.simpleRouteJson))
  circuit.add(<NativeFullBoard source={source} />)
  await circuit.renderUntilSettled()
  const json = circuit.getCircuitJson()
  expect(json.filter((e) => e.type === "pcb_autorouting_error")).toEqual([])
  expect(inputs[0].connections[0].pointsToConnect).toHaveLength(2)
  expect(inputs[0].obstacles.some((o: any) => o.isCopperPour)).toBe(true)
  expect(json.filter((e) => e.type === "source_net")).toHaveLength(1)
  expect(json.filter((e) => e.type === "pcb_copper_pour").length).toBeGreaterThan(0)
  expect(json.filter((e) => e.type === "pcb_via").length).toBeGreaterThanOrEqual(2)
  const modulePath = new URL("./patched-core/find-floating-copper.js", import.meta.url).href
  const { findFloatingCopper } = await import(modulePath)
  const ports = new Map(json.filter((e) => e.type === "pcb_port").map((p) => [p.source_port_id,p]))
  expect(arePortsConnected([...ports.keys()], json.filter((e) => e.type === "pcb_trace"), ports,
    json.filter((e) => e.type === "pcb_via"), findFloatingCopper(json).copperConnectedPointGroups)).toBe(true)
})
