import { sel } from "@tscircuit/core"

export default () => (
  <board width="16mm" height="12mm" routingDisabled>
    <chip name="U1" footprint="soic4" pcbX={-3} pcbY={0} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={2.5} pcbY={2.2} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={2.5} pcbY={0.4} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={2.5} pcbY={-2.2} />
    <trace from={sel.U1.pin1} to={sel.R1.pin1} />
    <trace from={sel.U1.pin1} to={sel.R2.pin1} />
    <trace from={sel.U1.pin4} to={sel.C1.pin1} />
  </board>
)
