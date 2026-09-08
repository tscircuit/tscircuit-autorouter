export default () => (
  <board schAutoLayoutEnabled={false} width="30mm" height="20mm" layers={2} minTraceWidth="0.25mm" nominalTraceWidth="0.25mm" autorouter={{local: true, traceClearance: 0.25}} routingTolerances={{minTraceWidth: 0.25, minTraceToPadEdgeClearance: 0.25, minPadEdgeToPadEdgeClearance: 0.25, minBoardEdgeClearance: 0.25}}>
    <schematicsection name="Divider" displayName="5 V input / 2.5 V unloaded output" />
      <pinheader schSectionName="Divider" name="J1" pinCount={2} pitch="2.54mm" footprint="pinrow2" pinLabels={["VIN", "GND"]} showSilkscreenPinLabels pcbX={-12} pcbY={0} pcbRotation={90} schX={-5} schY={0} schFacingDirection="right" />
      <pinheader schSectionName="Divider" name="J2" pinCount={2} pitch="2.54mm" footprint="pinrow2" pinLabels={["VOUT", "GND"]} showSilkscreenPinLabels pcbX={12} pcbY={0} pcbRotation={90} schX={5} schY={0} schFacingDirection="left" />
      <resistor schSectionName="Divider" name="R1" resistance="10k" footprint="0805" pcbX={-4} pcbY={3} schX={-2} schY={-1.5} />
      <resistor schSectionName="Divider" name="R2" resistance="10k" footprint="0805" pcbX={4} pcbY={-2} schX={2} schY={-1} schRotation={90} />
      <testpoint schSectionName="Divider" name="TP1" footprintVariant="pad" padShape="circle" padDiameter="1.5mm" pcbX={2} pcbY={4} schX={1} schY={2.5} />
      <testpoint schSectionName="Divider" name="TP2" footprintVariant="pad" padShape="circle" padDiameter="1.5mm" pcbX={2} pcbY={-5} schX={1} schY={-3} />
      <net name="VIN" /><net name="VOUT" /><net name="GND" />
      <trace from=".J1 > .pin1" to="net.VIN" thickness="0.25mm" />
      <trace from=".R1 > .pin1" to="net.VIN" thickness="0.25mm" />
      <trace from=".R1 > .pin2" to="net.VOUT" thickness="0.25mm" />
      <trace from=".R2 > .pin1" to="net.VOUT" thickness="0.25mm" />
      <trace from=".J2 > .pin1" to="net.VOUT" thickness="0.25mm" />
      <trace from=".TP1 > .pin1" to="net.VOUT" thickness="0.25mm" />
      <trace from=".J1 > .pin2" to="net.GND" thickness="0.25mm" />
      <trace from=".J2 > .pin2" to="net.GND" thickness="0.25mm" />
      <trace from=".R2 > .pin2" to="net.GND" thickness="0.25mm" />
      <trace from=".TP2 > .pin1" to="net.GND" thickness="0.25mm" />
    
    <silkscreentext text="J1 1:VIN 2:GND" pcbX={-8} pcbY={7} fontSize={0.8} />
    <silkscreentext text="J2 1:VOUT 2:GND" pcbX={7} pcbY={7} fontSize={0.8} />
    <silkscreentext text="TP1 VOUT" pcbX={4} pcbY={5.7} fontSize={0.8} />
    <silkscreentext text="TP2 GND" pcbX={4} pcbY={-7} fontSize={0.8} />
  </board>
)
