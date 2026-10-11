/** @jsxImportSource react-for-pipeline9-fixtures */
import {
  RootCircuit,
  getSimpleRouteJsonFromCircuitJson,
} from "./pipeline9CoreRuntime.mjs"
import type { CircuitJson } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"

/** Board-world points in mm: +X right, +Y up, +Z above; right handed. */
export async function getCompactViaCopperCircuit(
  explicitViaContacts = false,
): Promise<{ circuitJson: CircuitJson; srj: SimpleRouteJson }> {
  const circuit = new RootCircuit()
  // The runtime supports pcbPath; the repository's legacy Core337 JSX types
  // predate it. Pass the authored props without loading a second global JSX graph.
  const viaPoint = {
    x: -0.825,
    y: 3,
    via: true,
    fromLayer: "top",
    toLayer: "bottom",
  }
  const compactPath = {
    pcbPath: explicitViaContacts
      ? [{ x: -0.825, y: 3 }, viaPoint, { x: -0.825, y: 3 }]
      : [viaPoint],
  }
  circuit.add(
    <board
      width={10}
      height={10}
      layers={4}
      routingDisabled
      minTraceWidth={0.2}
    >
      <resistor
        name="R1"
        resistance="10k"
        footprint="0603"
        pcbX={0.825}
        pcbY={-2}
      />
      <resistor
        name="R2"
        resistance="10k"
        footprint="0603"
        pcbX={2.825}
        pcbY={1}
        layer="bottom"
      />
      <resistor name="R3" resistance="10k" footprint="0603" pcbX={-2.825} />
      <resistor name="R4" resistance="10k" footprint="0603" pcbX={2.825} />
      <resistor
        name="R5"
        resistance="10k"
        footprint="0603"
        pcbX={0.175}
        pcbY={-1}
        layer="bottom"
      />
      <resistor
        name="R6"
        resistance="10k"
        footprint="0603"
        pcbX={0.175}
        pcbY={3}
        layer="bottom"
      />
      <trace
        name="RETAINED"
        from="R1.1"
        to="R2.2"
        thickness={0.2}
        {...compactPath}
      />
      <trace name="TOP_CROSSING" from="R3.2" to="R4.1" thickness={0.2} />
      <trace name="BOTTOM_CROSSING" from="R5.1" to="R6.1" thickness={0.2} />
    </board>,
  )
  circuit.schematicDisabled = true
  await circuit.renderUntilSettled()
  const circuitJson = circuit.getCircuitJson() as CircuitJson
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({ circuitJson })
  // This is the actual public Core conversion, with no removed route points,
  // inserted contacts, replaced obstacles, or hand-authored SRJ geometry.
  return { circuitJson, srj: simpleRouteJson as SimpleRouteJson }
}
