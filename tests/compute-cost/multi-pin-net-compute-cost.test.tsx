/** @jsxImportSource react-for-pipeline9-fixtures */
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import {
  RootCircuit,
  getSimpleRouteJsonFromCircuitJson,
} from "../fixtures/pipeline9CoreRuntime.mjs"

// One GND net joins four pads, so the autorouter splits it into pairs.
const MultiPinNetBoard = () => (
  <board width={20} height={14} layers={2} routingDisabled>
    <chip name="U1" footprint="soic8" pcbX={0} pcbY={0} />
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-6} pcbY={4} />
    <resistor name="R2" resistance="1k" footprint="0402" pcbX={6} pcbY={4} />
    <resistor name="R3" resistance="1k" footprint="0402" pcbX={0} pcbY={-5} />
    <trace from=".U1 > .pin4" to="net.GND" />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin2" to="net.GND" />
    <trace from=".R3 > .pin1" to="net.GND" />
    <trace from=".U1 > .pin1" to=".R1 > .pin2" />
  </board>
)

test("compute cost keeps every pair of a split net traceable to its pads", async () => {
  const circuit = new RootCircuit()
  circuit.schematicDisabled = true
  circuit.add(<MultiPinNetBoard />)
  await circuit.renderUntilSettled()
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    circuitJson: circuit.getCircuitJson(),
    minTraceWidth: 0.15,
  })
  const solver = new AutoroutingPipelineSolver({
    ...simpleRouteJson,
    traces: [],
  })
  solver.solve()
  expect(solver.solved).toBe(true)

  const computeCost = solver.getComputeCostSummary()!
  const srjNames = new Set(simpleRouteJson.connections.map((c: any) => c.name))
  const pcbPortIds = new Set(
    simpleRouteJson.connections.flatMap((c: any) =>
      c.pointsToConnect.map((p: any) => p.pcb_port_id),
    ),
  )

  expect(computeCost.measuredPairCount).toBeGreaterThan(
    simpleRouteJson.connections.length,
  )
  expect(computeCost.totalIterations).toBe(
    computeCost.pairs.reduce((sum, pair) => sum + pair.iterations, 0),
  )
  for (const pair of computeCost.pairs) {
    expect(pair.rootConnectionNames.every((name) => srjNames.has(name))).toBe(
      true,
    )
    expect(
      pair.pcbPortIds.every((id) => id !== null && pcbPortIds.has(id)),
    ).toBe(true)
  }
})
