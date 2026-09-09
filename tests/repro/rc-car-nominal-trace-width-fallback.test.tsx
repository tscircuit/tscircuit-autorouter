import { RootCircuit } from "@tscircuit/core"
import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { SimpleRouteConnection } from "lib/types"
import { CapacityMeshAutorouterCoreBinding } from "../fixtures/CapacityMeshAutorouterCoreBinding"

test("reproduces rc car motor trace falling below its requested width", async () => {
  const circuit = new RootCircuit()

  circuit.add(
    <board
      width="30mm"
      height="12mm"
      autorouter={{
        local: true,
        groupMode: "subcircuit",
        async algorithmFn(simpleRouteJson) {
          return new CapacityMeshAutorouterCoreBinding({
            ...simpleRouteJson,
            connections: simpleRouteJson.connections.map(
              (connection: SimpleRouteConnection) => ({
                ...connection,
                nominalTraceWidth: 1.2,
                width: 1.2,
              }),
            ),
          })
        },
      }}
    >
      <chip
        name="U1"
        pcbX={-10}
        footprint="soic16"
        pinLabels={{ pin1: ["AOUT1"], pin2: ["AOUT2"] }}
      />
      <pinheader
        name="J1"
        pinCount={2}
        pitch="2.54mm"
        pcbX={11}
        pcbRotation={90}
        pinLabels={["MOTOR_A1", "MOTOR_A2"]}
      />
      <capacitor
        name="C1"
        capacitance="100nF"
        footprint="0805"
        pcbX={7}
      />
      <trace from=".U1 > .AOUT1" to="net.MOTOR_A1" thickness="1.2mm" />
      <trace from=".J1 > .MOTOR_A1" to="net.MOTOR_A1" thickness="1.2mm" />
      <trace from=".C1 > .pos" to="net.MOTOR_A1" thickness="1.2mm" />
      <trace from=".U1 > .AOUT2" to="net.MOTOR_A2" thickness="1.2mm" />
      <trace from=".J1 > .MOTOR_A2" to="net.MOTOR_A2" thickness="1.2mm" />
      <trace from=".C1 > .neg" to="net.MOTOR_A2" thickness="1.2mm" />
    </board>,
  )

  await circuit.renderUntilSettled()

  const circuitJson = circuit.getCircuitJson()
  const routedWidths = circuitJson
    .filter((element) => element.type === "pcb_trace")
    .flatMap((trace) =>
      trace.route.flatMap((point) =>
        point.route_type === "wire" ? [point.width] : [],
      ),
    )
  expect(Math.min(...routedWidths)).toBe(0.15)
  expect(routedWidths.some((width) => width < 1.2)).toBe(true)
  expect(
    convertCircuitJsonToPcbSvg(circuitJson as AnyCircuitElement[]),
  ).toMatchSvgSnapshot(import.meta.path)
})
