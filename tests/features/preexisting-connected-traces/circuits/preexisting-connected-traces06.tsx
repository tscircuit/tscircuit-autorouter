import { sel } from "@tscircuit/core"

export default () => (
  <board width="14mm" height="10mm" routingDisabled>
    <chip name="U1" footprint="soic4" pcbX={-2} pcbY={0} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={3} pcbY={1.4} />
    <trace from={sel.U1.pin1} to={sel.R1.pin1} />
  </board>
)
