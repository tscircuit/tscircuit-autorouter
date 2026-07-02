import { sel } from "@tscircuit/core"

export default () => (
  <board width="16mm" height="12mm" routingDisabled>
    <chip name="U1" footprint="soic4" pcbX={-3} pcbY={0} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={2.5} pcbY={2.4} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={2.5} pcbY={0} />
    <resistor name="R3" resistance="1k" footprint="0603" pcbX={2.5} pcbY={-2.4} />
    <trace from={sel.U1.pin1} to={sel.R1.pin1} />
    <trace from={sel.U1.pin1} to={sel.R2.pin1} />
    <trace from={sel.U1.pin1} to={sel.R3.pin1} />
  </board>
)
