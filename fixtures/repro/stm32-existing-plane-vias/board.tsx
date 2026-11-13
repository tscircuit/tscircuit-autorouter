import type { AutorouterProp } from "@tscircuit/props"
import type { ReactElement } from "react"
import { STM32MP157DAB1 } from "./STM32MP157DAB1"

// The motherboard's complete STM32 footprint and 104 GND connections.
// Keep its native dogbone settings and top-side placement. Other subsystems
// are omitted to isolate the handoff from dogbone to planned-plane access.
export default function Stm32ExistingPlaneVias({
  autorouter = "auto-local",
}: { autorouter?: AutorouterProp } = {}): ReactElement {
  return (
    <board
      width={34}
      height={28}
      layers={6}
      schematicDisabled
      autorouter={autorouter}
      minTraceWidth={0.15}
      minViaHoleDiameter={0.15}
      minViaPadDiameter={0.3}
      minTraceToPadEdgeClearance={0.125}
      minPadEdgeToPadEdgeClearance={0.15}
      isViaInPadAllowed
    >
      <net name="GND" isGroundNet />
      <copperpour
        name="GND_REFERENCE"
        connectsTo="net.GND"
        layer="inner1"
        unbroken
        clearance={0.2}
        boardEdgeMargin={0.5}
        useThermalReliefs={false}
      />
      <breakout
        name="MPU_ESCAPE"
        width={20}
        height={20}
        autorouter="dogbone"
        fanoutPourNetMap={{}}
        fanoutRoutingLayers={["top", "inner3"]}
      >
        <STM32MP157DAB1 />
        <trace from="U70.A1" to="net.GND" />
        <trace from="U70.A19" to="net.GND" />
        <trace from="U70.B2" to="net.GND" />
        <trace from="U70.B6" to="net.GND" />
        <trace from="U70.C3" to="net.GND" />
        <trace from="U70.C12" to="net.GND" />
        <trace from="U70.C13" to="net.GND" />
        <trace from="U70.C14" to="net.GND" />
        <trace from="U70.C15" to="net.GND" />
        <trace from="U70.C16" to="net.GND" />
        <trace from="U70.C17" to="net.GND" />
        <trace from="U70.D1" to="net.GND" />
        <trace from="U70.D4" to="net.GND" />
        <trace from="U70.D5" to="net.GND" />
        <trace from="U70.D8" to="net.GND" />
        <trace from="U70.E2" to="net.GND" />
        <trace from="U70.E4" to="net.GND" />
        <trace from="U70.E5" to="net.GND" />
        <trace from="U70.E6" to="net.GND" />
        <trace from="U70.E8" to="net.GND" />
        <trace from="U70.E10" to="net.GND" />
        <trace from="U70.E12" to="net.GND" />
        <trace from="U70.E14" to="net.GND" />
        <trace from="U70.E16" to="net.GND" />
        <trace from="U70.F5" to="net.GND" />
        <trace from="U70.F7" to="net.GND" />
        <trace from="U70.F9" to="net.GND" />
        <trace from="U70.F11" to="net.GND" />
        <trace from="U70.F13" to="net.GND" />
        <trace from="U70.F15" to="net.GND" />
        <trace from="U70.G2" to="net.GND" />
        <trace from="U70.G4" to="net.GND" />
        <trace from="U70.G6" to="net.GND" />
        <trace from="U70.G8" to="net.GND" />
        <trace from="U70.G10" to="net.GND" />
        <trace from="U70.G12" to="net.GND" />
        <trace from="U70.G14" to="net.GND" />
        <trace from="U70.H1" to="net.GND" />
        <trace from="U70.H5" to="net.GND" />
        <trace from="U70.H7" to="net.GND" />
        <trace from="U70.H9" to="net.GND" />
        <trace from="U70.H11" to="net.GND" />
        <trace from="U70.H13" to="net.GND" />
        <trace from="U70.H15" to="net.GND" />
        <trace from="U70.J3" to="net.GND" />
        <trace from="U70.J4" to="net.GND" />
        <trace from="U70.J6" to="net.GND" />
        <trace from="U70.J8" to="net.GND" />
        <trace from="U70.J10" to="net.GND" />
        <trace from="U70.J12" to="net.GND" />
        <trace from="U70.J14" to="net.GND" />
        <trace from="U70.K2" to="net.GND" />
        <trace from="U70.K4" to="net.GND" />
        <trace from="U70.K5" to="net.GND" />
        <trace from="U70.K7" to="net.GND" />
        <trace from="U70.K9" to="net.GND" />
        <trace from="U70.K11" to="net.GND" />
        <trace from="U70.K13" to="net.GND" />
        <trace from="U70.K15" to="net.GND" />
        <trace from="U70.L4" to="net.GND" />
        <trace from="U70.L6" to="net.GND" />
        <trace from="U70.L8" to="net.GND" />
        <trace from="U70.L10" to="net.GND" />
        <trace from="U70.L12" to="net.GND" />
        <trace from="U70.L14" to="net.GND" />
        <trace from="U70.M3" to="net.GND" />
        <trace from="U70.M5" to="net.GND" />
        <trace from="U70.M7" to="net.GND" />
        <trace from="U70.M9" to="net.GND" />
        <trace from="U70.M11" to="net.GND" />
        <trace from="U70.M13" to="net.GND" />
        <trace from="U70.M15" to="net.GND" />
        <trace from="U70.N4" to="net.GND" />
        <trace from="U70.N6" to="net.GND" />
        <trace from="U70.N8" to="net.GND" />
        <trace from="U70.N10" to="net.GND" />
        <trace from="U70.N12" to="net.GND" />
        <trace from="U70.N14" to="net.GND" />
        <trace from="U70.P5" to="net.GND" />
        <trace from="U70.P7" to="net.GND" />
        <trace from="U70.P9" to="net.GND" />
        <trace from="U70.P11" to="net.GND" />
        <trace from="U70.P13" to="net.GND" />
        <trace from="U70.P15" to="net.GND" />
        <trace from="U70.R2" to="net.GND" />
        <trace from="U70.R5" to="net.GND" />
        <trace from="U70.R6" to="net.GND" />
        <trace from="U70.R8" to="net.GND" />
        <trace from="U70.R10" to="net.GND" />
        <trace from="U70.R12" to="net.GND" />
        <trace from="U70.R14" to="net.GND" />
        <trace from="U70.R16" to="net.GND" />
        <trace from="U70.T4" to="net.GND" />
        <trace from="U70.T15" to="net.GND" />
        <trace from="U70.U3" to="net.GND" />
        <trace from="U70.U6" to="net.GND" />
        <trace from="U70.U8" to="net.GND" />
        <trace from="U70.U13" to="net.GND" />
        <trace from="U70.U14" to="net.GND" />
        <trace from="U70.U17" to="net.GND" />
        <trace from="U70.V12" to="net.GND" />
        <trace from="U70.V15" to="net.GND" />
        <trace from="U70.W1" to="net.GND" />
        <trace from="U70.W19" to="net.GND" />
      </breakout>
      <resistor name="R1" resistance="1k" footprint="0603" pcbX={14} />
      <trace from="R1.pin1" to="net.GND" />
    </board>
  )
}
