import { RootCircuit, SimpleRouteJson } from "@tscircuit/core"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { useMemo, useState } from "react"
import { Fragment } from "react/jsx-runtime"
import { CapacityMeshAutorouterCoreBinding } from "tests/fixtures/CapacityMeshAutorouterCoreBinding"

const getSimpleRouteJsonFromTscircuit = () => {
  const circuit = new RootCircuit()
  const outputs: { srj?: SimpleRouteJson } = {}
  circuit.add(
    <board
      width="10mm"
      height="100mm"
      autorouter={{
        local: true,
        groupMode: "subcircuit",
        async algorithmFn(srj) {
          outputs.srj = srj
        },
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

  circuit.render()

  return outputs.srj!
}

export default () => {
  const simpleRouteJson = useMemo(getSimpleRouteJsonFromTscircuit, [])

  return <AutoroutingPipelineDebugger srj={simpleRouteJson as any} />
}
