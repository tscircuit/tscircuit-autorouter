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
  const footprint = (
    <footprint>
      <smtpad portHints={["pin1"]} shape="rect" width={0.5} height={0.5} />
    </footprint>
  )
  // The runtime supports pcbPath; the repository's legacy Core337 JSX types
  // predate it. Pass the authored props without loading a second global JSX graph.
  const viaPoint = {
    x: 0,
    y: 3,
    via: true,
    fromLayer: "top",
    toLayer: "bottom",
  }
  const compactPath = {
    pcbPath: explicitViaContacts
      ? [{ x: 0, y: 3 }, viaPoint, { x: 0, y: 3 }]
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
      <chip name="SAVED_START" pcbY={-2} footprint={footprint} />
      <chip
        name="SAVED_END"
        pcbX={2}
        pcbY={1}
        layer="bottom"
        footprint={footprint}
      />
      <chip name="TOP_LEFT" pcbX={-2} footprint={footprint} />
      <chip name="TOP_RIGHT" pcbX={2} footprint={footprint} />
      <chip
        name="BOTTOM_LOWER"
        pcbX={1}
        pcbY={-1}
        layer="bottom"
        footprint={footprint}
      />
      <chip
        name="BOTTOM_UPPER"
        pcbX={1}
        pcbY={3}
        layer="bottom"
        footprint={footprint}
      />
      <trace
        name="RETAINED"
        from="SAVED_START.1"
        to="SAVED_END.1"
        thickness={0.2}
        {...compactPath}
      />
      <trace
        name="TOP_CROSSING"
        from="TOP_LEFT.1"
        to="TOP_RIGHT.1"
        thickness={0.2}
      />
      <trace
        name="BOTTOM_CROSSING"
        from="BOTTOM_LOWER.1"
        to="BOTTOM_UPPER.1"
        thickness={0.2}
      />
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
