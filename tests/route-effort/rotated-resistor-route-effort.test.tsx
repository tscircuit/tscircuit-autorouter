/** @jsxImportSource react-for-pipeline9-fixtures */
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import {
  RootCircuit,
  getSimpleRouteJsonFromCircuitJson,
} from "../fixtures/pipeline9CoreRuntime.mjs"

// R2 is rotated 180°, so its two traces must cross beside it. Every other
// resistor sits in line with its header pin and chip pin; J2 fans out the
// chip's other side.
const RotatedResistorBoard = () => (
  <board width={34} height={20} layers={2} routingDisabled>
    <chip name="U1" footprint="tssop20" pcbX={0} pcbY={0} />
    <chip name="J1" footprint="pinrow8" pcbX={-11} pcbY={0} pcbRotation={270} />
    <chip name="J2" footprint="pinrow6" pcbX={8} pcbY={0} pcbRotation={90} />
    {Array.from({ length: 8 }, (_, i) => (
      <resistor
        name={`R${i + 1}`}
        resistance="1k"
        footprint="0402"
        pcbX={-5}
        pcbY={3.5 - i}
        pcbRotation={i === 1 ? 180 : 0}
      />
    ))}
    {Array.from({ length: 8 }, (_, i) => (
      <>
        <trace from={`.J1 > .pin${i + 1}`} to={`.R${i + 1} > .pin1`} />
        <trace from={`.R${i + 1} > .pin2`} to={`.U1 > .pin${i + 1}`} />
      </>
    ))}
    {Array.from({ length: 6 }, (_, i) => (
      <trace from={`.U1 > .pin${11 + i}`} to={`.J2 > .pin${i + 1}`} />
    ))}
  </board>
)

test("hypergraph route effort points at the rotated resistor", async () => {
  const circuit = new RootCircuit()
  circuit.schematicDisabled = true
  circuit.add(<RotatedResistorBoard />)
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

  const effort = solver.getRouteEffortSummary()!
  const selectorByPcbPortId = new Map(
    simpleRouteJson.connections.flatMap((c: any) =>
      c.pointsToConnect.map((p: any) => [p.pcb_port_id, p.port_selector]),
    ),
  )
  const [top] = effort.pairs
  const median = effort.pairs[Math.floor(effort.pairs.length / 2)]!

  expect(effort.measuredPairCount).toBe(simpleRouteJson.connections.length)
  expect(top!.pcbPortIds.map((id) => selectorByPcbPortId.get(id))).toContain(
    "R2.pin2",
  )
  expect(top!.iterations).toBeGreaterThan(median.iterations * 3)
})
