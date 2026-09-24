import { expect, test } from "bun:test"
import { LocalDrcRepairSolver } from "lib/solvers/LocalDrcRepairSolver/LocalDrcRepairSolver"
import { createLocalDrcRepairFixture, localWire } from "../fixtures/local-drc-repair-fixture"

test("clearance cleanup preserves same-net branches, pad contacts and bare terminal contacts", (): void => {
  for (const contact of ["branch", "pad", "terminal"]) {
    const input = createLocalDrcRepairFixture()
    if (contact === "branch") input.traces.push({ type: "pcb_trace", pcb_trace_id: "branch", connection_name: "signal", route: [localWire(0, 3.5), localWire(0, 4.195)] })
    if (contact === "pad") input.originalSrj.obstacles.push({ type: "rect", center: { x: 0, y: 4.195 }, width: 0.1, height: 0.1, layers: ["top"], connectedTo: ["signal", "pcb_smtpad_contact"], circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_contact" } })
    if (contact === "terminal") input.originalSrj.connections.find((c) => c.name === "signal")!.pointsToConnect.push({ x: 0, y: 4.245, layer: "top" })
    const before = structuredClone(input.traces[3]!)
    const solver = new LocalDrcRepairSolver(input)
    solver.solve()
    expect(solver.failed, solver.error ?? "").toBeFalse()
    expect(solver.getOutput()[3], contact).toEqual(before)
    expect(solver.stats.mergedViaGroups).toBe(1)
  }
})
