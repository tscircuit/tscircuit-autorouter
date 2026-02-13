import { RootCircuit, sel } from "@tscircuit/core"
import { test, expect } from "bun:test"
import { CapacityMeshAutorouterCoreBinding } from "./fixtures/CapacityMeshAutorouterCoreBinding"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { AnyCircuitElement } from "circuit-json"
import { Fragment } from "react/jsx-runtime"

test.skip("core3 - 0402 columns", async () => {
  const circuit = new RootCircuit()

  circuit.add(
    <board
      width="10mm"
      height="100mm"
      autorouter={{
        local: true,
        groupMode: "subcircuit",
      }}
    >
      {Array.from({ length: 30 }).map((_, i) => (
        <Fragment key={i.toString()}>
          <capacitor
            capacitance="1000pF"
            footprint="0402"
            name={`C${i}`}
            schX={-3}
            pcbX={-3}
            pcbY={(i / 30 - 0.5) * 60}
          />
          <resistor
            resistance="1k"
            footprint="0402"
            name={`R${i}`}
            schX={3}
            pcbX={3}
            pcbY={(i / 30 - 0.5) * 60}
          />
          <trace from={`.R${i} > .pin1`} to={`.C${i} > .pin1`} />
        </Fragment>
      ))}
    </board>,
  )

  await circuit.renderUntilSettled()

  const circuitJson = circuit.getCircuitJson()

  expect(
    convertCircuitJsonToPcbSvg(circuitJson as AnyCircuitElement[]),
  ).toMatchSvgSnapshot(import.meta.path)
})
