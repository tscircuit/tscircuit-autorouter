/** @jsxImportSource ./jsx */
// Source: https://tscircuit.com/gokul/sepic-converter
import type { BoardProps } from "@tscircuit/props-for-sepic-repro"
import type { ReactElement } from "react"
import { MountingHoles } from "./components/MountingHoles"
import { InputFilter } from "./circuit/InputFilter"
import { SepicPowerStage } from "./circuit/SepicPowerStage"
import { ControlLoop } from "./circuit/ControlLoop"
import { OutputAdjustment } from "./circuit/OutputAdjustment"

export default function BuckBoostConverter({
  autorouter,
}: { autorouter?: BoardProps["autorouter"] } = {}): ReactElement {
  return (
    <board
      width="56mm"
      height="44mm"
      layers={2}
      autorouter={autorouter ?? { traceClearance: "0.25mm" }}
      autorouterVersion="beta_pipeline9"
      schLayout={{ layoutMode: "none" }}
      title="12 V to adjustable 5–24 V SEPIC"
    >
      <net name="VIN" isPowerNet nominalTraceWidth="1.2mm" />
      <net name="VOUT" isPowerNet nominalTraceWidth="1mm" />
      <net name="SW" nominalTraceWidth="1.2mm" />
      <net name="SEPIC" nominalTraceWidth="1.2mm" />
      <net name="SENSE" nominalTraceWidth="1.2mm" />
      <net name="GND" isGroundNet nominalTraceWidth="1.2mm" />
      <MountingHoles />
      <schematicsheet
        name="Converter"
        displayName="12 V to adjustable 5–24 V / 1 A target"
      >
        <InputFilter />
        <SepicPowerStage />
        <ControlLoop />
        <OutputAdjustment />
      </schematicsheet>
      <silkscreentext text="J1 12V IN" pcbX={-23} pcbY={13} fontSize={1} />
      <silkscreentext text="J2 5–24V OUT" pcbX={23} pcbY={13} fontSize={1} />
      <silkscreentext text="ADJUST" pcbX={15} pcbY={-20.3} fontSize={0.8} />
      <silkscreentext text="+" pcbX={-18.3} pcbY={8} fontSize={0.7} />
      <silkscreentext text="-" pcbX={-18.3} pcbY={3} fontSize={0.7} />
      <silkscreentext text="+" pcbX={18.3} pcbY={3} fontSize={0.7} />
      <silkscreentext text="-" pcbX={18.3} pcbY={8} fontSize={0.7} />
      <silkscreentext
        text="SEPIC / 1A TARGET"
        pcbX={0}
        pcbY={21}
        fontSize={0.8}
      />
    </board>
  )
}
