import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { checkEachPcbPortConnectedToPcbTraces } from "@tscircuit/checks"
import input from "../../fixtures/bug-reports/beagleplay-am6254-ddr4/input.srj.json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { canValidatePipeline9ReferenceCopper } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canValidatePipeline9ReferenceCopper"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { getMinimumTraceGap } from "../fixtures/getMinimumTraceGap"

test("BeaglePlay DDR4 routes all 51 signals without clearance violations", (): void => {
  const srj = input as SimpleRouteJson
  expect(srj.layerCount).toBe(8)
  expect(srj.bounds).toEqual({
    minX: 0,
    minY: 0,
    maxX: 80.00238,
    maxY: 80.00238,
  })
  expect(srj.obstacles).toHaveLength(521)
  expect(srj.traces).toBeUndefined()

  const am6254Pads = srj.obstacles.filter((pad) => pad.componentId === "U1")
  const ddr4Pads = srj.obstacles.filter((pad) => pad.componentId === "U2")
  expect(am6254Pads).toHaveLength(425)
  expect(ddr4Pads).toHaveLength(96)
  const ballIds = new Set<string>()
  for (const pad of [...am6254Pads, ...ddr4Pads]) {
    expect(pad.layers).toEqual(["bottom"])
    const metadata = pad.circuitJsonMetadata
    expect(metadata?.source_component_name).toBe(pad.componentId)
    expect(metadata?.source_port_name).toBeTruthy()
    ballIds.add(
      `${metadata?.source_component_name}.${metadata?.source_port_name}`,
    )
  }
  expect(ballIds.size).toBe(521)

  const nets = new Map(srj.connections.map((net) => [net.name, net]))
  expect(nets.size).toBe(51)
  expect([...nets.keys()].every((name) => name.startsWith("DDR_"))).toBe(true)
  expect(nets.has("DDR_VPP")).toBe(false)
  expect(nets.has("DDR_VREFCA")).toBe(false)
  expect(nets.has("DDR_TEN")).toBe(false)
  for (let bit = 0; bit < 16; bit++) {
    expect(nets.get(`DDR_DQ${bit}`)?.pointsToConnect).toHaveLength(2)
  }
  expect(
    nets.get("DDR_CLKP")?.pointsToConnect.map((point) => point.pointId),
  ).toEqual(["U1.L1", "U2.K7"])

  const terminals = srj.connections.flatMap((net) => net.pointsToConnect)
  expect(terminals).toHaveLength(102)
  expect(new Set(terminals.map((point) => point.pointId)).size).toBe(102)
  for (const { name, pointsToConnect } of srj.connections) {
    const [controller, ram] = pointsToConnect
    expect(pointsToConnect).toHaveLength(2)
    expect(controller?.pointId?.startsWith("U1.")).toBe(true)
    expect(ram?.pointId?.startsWith("U2.")).toBe(true)
    for (const point of pointsToConnect) {
      expect(point.pcb_port_id).toBe(point.pointId)
      const layers = point.layers ?? [point.layer]
      expect(
        srj.obstacles.some(
          (pad) =>
            pad.connectedTo.includes(name) &&
            pad.circuitJsonMetadata?.pcb_port_id === point.pcb_port_id &&
            pad.center.x === point.x &&
            pad.center.y === point.y &&
            layers.every((layer) => pad.layers.includes(layer)),
        ),
      ).toBe(true)
    }
  }

  for (const name of ["unrouted", "routed"]) {
    const png = readFileSync(
      new URL(
        `../../fixtures/bug-reports/beagleplay-am6254-ddr4/images/${name}.png`,
        import.meta.url,
      ),
    )
    // The PNG IHDR stores the canvas width and height at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1536, 853])
  }

  const requiredClearance = srj.minTraceToPadEdgeClearance
  expect(requiredClearance).toBe(0.081)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const routesByNet = new Map(
    routedTraces.map((trace) => [trace.connection_name, trace]),
  )
  expect(routedTraces).toHaveLength(51)
  expect([...routesByNet.keys()].sort()).toEqual([...nets.keys()].sort())

  // These two pairs fell below clearance in the original report and PR base.
  const parity = routesByNet.get("DDR_PARITY")!
  for (const name of ["DDR_A6", "DDR_A7"]) {
    const gap = getMinimumTraceGap(parity, routesByNet.get(name)!)
    expect(gap, `DDR_PARITY / ${name}`).toBeGreaterThanOrEqual(
      requiredClearance!,
    )
  }

  const { circuitJson, errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    includeBoardClearance: true,
    drcOptions: { traceClearance: requiredClearance },
  })
  const pads = circuitJson.filter((element) => element.type === "pcb_smtpad")
  const ports = circuitJson.filter((element) => element.type === "pcb_port")
  expect(pads).toHaveLength(521)
  expect(ports).toHaveLength(102)
  expect(
    pads.flatMap((pad) => (pad.pcb_port_id ? [pad.pcb_port_id] : [])).sort(),
  ).toEqual(ports.map((port) => port.pcb_port_id).sort())
  expect(checkEachPcbPortConnectedToPcbTraces(circuitJson)).toEqual([])
  expect(errors).toEqual([])

  const referenceContext = {
    originalSrj: srj,
    connections: srj.connections,
    hasNativePreloadedTraces: false,
  }
  expect(canValidatePipeline9ReferenceCopper(referenceContext)).toBeFalse()
  expect(
    canValidatePipeline9ReferenceCopper({
      ...referenceContext,
      referenceCircuitJson: circuitJson,
    }),
  ).toBeTrue()
  for (const type of ["pcb_smtpad", "pcb_port"] as const) {
    expect(
      canValidatePipeline9ReferenceCopper({
        ...referenceContext,
        referenceCircuitJson: circuitJson.filter(
          (element) => element.type !== type || element.pcb_port_id !== "U1.L1",
        ),
      }),
    ).toBeFalse()
  }
})
