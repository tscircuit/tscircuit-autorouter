// Car receiver: an external 433.92 MHz ASK receiver supplies JRF.DATA.
// Motor budget: 150 mA running, 400 mA stall per motor.
export default function RfCarReceiver() {
  return (
    <board width="74mm" height="52mm" layers={2} autorouter="auto-local" bomDisabled
      title="433 MHz RC car — receiver and motor driver">
      <schematicsection name="power" displayName="External 5 V BEC + 6–9 V battery" />
      <schematicsection name="radio" displayName="433 MHz receiver harness" />
      <schematicsection name="decoder" displayName="HT12D: address 00000000" />
      <schematicsection name="drive" displayName="Dual motor drive with RF-valid enable" />
      <pinheader name="J5V" pinCount={2} pinLabels={["V5", "GND"]} showSilkscreenPinLabels
        pcbX={-30} pcbY={-18} schX={-24} schY={-12} schSectionName="power" />
      <pinheader name="JBAT" pinCount={2} pinLabels={["VM", "GND"]} showSilkscreenPinLabels
        pcbX={25} pcbY={-19} schX={-16} schY={-12} schSectionName="power" />
      <capacitor name="C5" capacitance="100uF" maxVoltageRating="16V"
        footprint={<footprint>
          <platedhole portHints={["1"]} pcbX={-1.75} pcbY={0} holeDiameter="0.8mm" outerDiameter="1.8mm" shape="circle" />
          <platedhole portHints={["2"]} pcbX={1.75} pcbY={0} holeDiameter="0.8mm" outerDiameter="1.8mm" shape="circle" />
          <silkscreencircle pcbX={0} pcbY={0} radius="4mm" />
        </footprint>}
        pcbX={23} pcbY={-11} schX={15} schY={-2} schRotation={-90} schSectionName="drive" />
      <capacitor name="C6" capacitance="10uF" maxVoltageRating="16V" footprint="0805"
        pcbX={-25} pcbY={-15} schX={-24} schY={-17} schRotation={-90} schSectionName="power" />
      <pinheader name="JRF" pinCount={3} pinLabels={["V5", "DATA", "GND"]} showSilkscreenPinLabels
        pcbX={-30} pcbY={14} schX={-25} schY={10} schSectionName="radio" />
      <capacitor name="C1" capacitance="100nF" maxVoltageRating="16V" footprint="0805"
        pcbX={-27} pcbY={9} schX={-22.5} schY={-17} schRotation={-90} schSectionName="power" />
      <chip name="U1" manufacturerPartNumber="HT12D" footprint="soic20_w10.3mm_p1.27mm"
        pcbX={-13} pcbY={3} schX={-10} schY={9} schSectionName="decoder"
        pinLabels={{pin1:"NC1",pin2:"A0",pin3:"A1",pin4:"A2",pin5:"A3",pin6:"A4",pin7:"A5",pin8:"A6",pin9:"A7",pin10:"VSS",pin11:"NC2",pin12:"D8",pin13:"D9",pin14:"D10",pin15:"D11",pin16:"DIN",pin17:"OSC2",pin18:"OSC1",pin19:"VT",pin20:"VDD"}}
        noConnect={["NC1", "NC2"]}
        schPinArrangement={{leftSide:{direction:"top-to-bottom",pins:["A0","A1","A2","A3","A4","A5","A6","A7","VSS"]},rightSide:{direction:"top-to-bottom",pins:["VDD","VT","DIN","D8","D9","D10","D11","OSC1","OSC2"]}}}
      />
      <resistor name="ROSC" resistance="51k" footprint="0805"
        pcbX={-4} pcbY={5} pcbRotation={270} schX={-3} schY={4} schSectionName="decoder" />
      <resistor name="RVT" resistance="47k" footprint="0805"
        pcbX={-3} pcbY={12} schX={-3} schY={14} schRotation={-90} schSectionName="decoder" />
      <capacitor name="C2" capacitance="100nF" maxVoltageRating="16V" footprint="0805"
        pcbX={-5} pcbY={10} schX={-24} schY={-18.5} schRotation={-90} schSectionName="power" />
      <chip name="U2" manufacturerPartNumber="L293DNE" footprint="dip16"
        pcbX={15} pcbY={0} schX={12} schY={9} schSectionName="drive"
        pinLabels={{pin1:"EN_L",pin2:"IN_L1",pin3:"OUT_L1",pin4:"GND1",pin5:"GND2",pin6:"OUT_L2",pin7:"IN_L2",pin8:"VM",pin9:"EN_R",pin10:"IN_R1",pin11:"OUT_R1",pin12:"GND3",pin13:"GND4",pin14:"OUT_R2",pin15:"IN_R2",pin16:"V5"}}
        schPinArrangement={{leftSide:{direction:"top-to-bottom",pins:["EN_L","EN_R","IN_L1","IN_L2","IN_R1","IN_R2","V5","VM"]},rightSide:{direction:"top-to-bottom",pins:["OUT_L1","OUT_L2","OUT_R1","OUT_R2","GND1","GND2","GND3","GND4"]}}}
      />
      <pinheader name="JML" pinCount={2} pinLabels={["L1", "L2"]} showSilkscreenPinLabels
        pcbX={5} pcbY={16} schX={25} schY={14} schSectionName="drive" />
      <pinheader name="JMR" pinCount={2} pinLabels={["R1", "R2"]} showSilkscreenPinLabels
        pcbX={28} pcbY={12} schX={25} schY={9} schSectionName="drive" />
      <capacitor name="C3" capacitance="100nF" maxVoltageRating="16V" footprint="0805"
        pcbX={22.5} pcbY={9} schX={-22.5} schY={-18.5} schRotation={-90} schSectionName="power" />
      <capacitor name="C4" capacitance="100nF" maxVoltageRating="16V" footprint="0805"
        pcbX={10} pcbY={-12.5} schX={16.5} schY={-2} schRotation={-90} schSectionName="drive" />
      <trace from=".J5V > .pin1" to="net.V5" thickness="0.5mm" />
      <trace from=".J5V > .pin2" to="net.GND" thickness="0.5mm" />
      <trace from=".JBAT > .pin1" to="net.VM" thickness="1mm" />
      <trace from=".JBAT > .pin2" to="net.GND" thickness="1mm" />
      <trace from=".C5 > .pin1" to="net.VM" thickness="1mm" />
      <trace from=".C5 > .pin2" to="net.GND" thickness="1mm" />
      <trace from=".C6 > .pin1" to="net.V5" thickness="0.5mm" />
      <trace from=".C6 > .pin2" to="net.GND" thickness="0.5mm" />
      <trace from=".JRF > .pin1" to="net.V5" thickness="0.5mm" />
      <trace from=".JRF > .pin2" to=".U1 > .DIN" thickness="0.25mm" />
      <trace from=".JRF > .pin3" to="net.GND" thickness="0.5mm" />
      <trace from=".C1 > .pin1" to="net.V5" thickness="0.5mm" />
      <trace from=".C1 > .pin2" to="net.GND" thickness="0.5mm" />
      {["A0","A1","A2","A3","A4","A5","A6","A7","VSS"].map(pin =>
        <trace key={pin} from={`.U1 > .${pin}`} to="net.GND" thickness="0.25mm" />)}
      <trace from=".U1 > .VDD" to="net.V5" thickness="0.5mm" />
      <trace from=".U1 > .OSC1" to=".ROSC > .pin1" thickness="0.25mm" />
      <trace from=".U1 > .OSC2" to=".ROSC > .pin2" thickness="0.25mm" />
      <trace from=".U1 > .VT" to="net.RF_VALID" thickness="0.25mm" />
      <trace from=".RVT > .pin1" to="net.RF_VALID" thickness="0.25mm" />
      <trace from=".RVT > .pin2" to="net.GND" thickness="0.25mm" />
      <trace from=".C2 > .pin1" to="net.V5" thickness="0.5mm" />
      <trace from=".C2 > .pin2" to="net.GND" thickness="0.5mm" />
      <trace from=".U1 > .D8" to=".U2 > .IN_L1" thickness="0.25mm" />
      <trace from=".U1 > .D9" to=".U2 > .IN_L2" thickness="0.25mm" />
      <trace from=".U1 > .D10" to=".U2 > .IN_R1" thickness="0.25mm" />
      <trace from=".U1 > .D11" to=".U2 > .IN_R2" thickness="0.25mm" />
      <trace from=".U2 > .EN_L" to="net.RF_VALID" thickness="0.25mm" />
      <trace from=".U2 > .EN_R" to="net.RF_VALID" thickness="0.25mm" />
      <trace from=".U2 > .VM" to="net.VM" thickness="1mm" />
      <trace from=".U2 > .V5" to="net.V5" thickness="0.5mm" />
      {["GND1","GND2","GND3","GND4"].map(pin =>
        <trace key={pin} from={`.U2 > .${pin}`} to="net.GND" thickness="1mm" />)}
      <trace from=".U2 > .OUT_L1" to=".JML > .pin1" thickness="1mm" />
      <trace from=".U2 > .OUT_L2" to=".JML > .pin2" thickness="1mm" />
      <trace from=".U2 > .OUT_R1" to=".JMR > .pin1" thickness="1mm" />
      <trace from=".U2 > .OUT_R2" to=".JMR > .pin2" thickness="1mm" />
      <trace from=".C3 > .pin1" to="net.V5" thickness="0.5mm" />
      <trace from=".C3 > .pin2" to="net.GND" thickness="0.5mm" />
      <trace from=".C4 > .pin1" to="net.VM" thickness="1mm" />
      <trace from=".C4 > .pin2" to="net.GND" thickness="1mm" />
    </board>
  )
}
