import { expect, test } from "bun:test"
import { RootCircuit } from "./core-runtime.mjs"
import { NativeFullBoard } from "./native-full-board"
import { createPlaneTestSource } from "./plane-test-source"
import { arePortsConnected } from "./connectivity"

test("same-net pour islands remain disconnected until actual copper joins them", async () => {
  const modulePath = new URL("./patched-core/find-floating-copper.js", import.meta.url).href
  const { findFloatingCopper } = await import(modulePath)
  const outcomes: boolean[] = []
  for (const outlines of [
    [[{x:-6,y:-3},{x:-1,y:-3},{x:-1,y:3},{x:-6,y:3}],
     [{x:1,y:-3},{x:6,y:-3},{x:6,y:3},{x:1,y:3}]],
    [[{x:-6,y:-3},{x:6,y:-3},{x:6,y:3},{x:-6,y:3}]],
  ]) {
    const circuit = new RootCircuit()
    circuit.add(<NativeFullBoard source={createPlaneTestSource(outlines,"top")} geometryOnly />)
    await circuit.renderUntilSettled()
    const json = circuit.getCircuitJson()
    expect(json.filter((e) => e.type === "pcb_trace")).toHaveLength(0)
    expect(json.filter((e) => e.type === "pcb_via")).toHaveLength(0)
    const ports = new Map(json.filter((e) => e.type === "pcb_port").map((p) => [p.source_port_id,p]))
    outcomes.push(arePortsConnected([...ports.keys()], [], ports, [], findFloatingCopper(json).copperConnectedPointGroups))
  }
  expect(outcomes).toEqual([false,true])
})
