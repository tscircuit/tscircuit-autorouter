import type { ChipProps } from "@tscircuit/props"

const regulatorPins = {
  pin1: "IN", pin2: "GND", pin3: "EN", pin4: "FB", pin5: "OUT",
} as const

/** TI DBV0005A example land pattern, rotated 90 degrees clockwise. */
function SOT235Footprint() {
  return <footprint>
    <smtpad portHints={["pin1"]} shape="rect" width={1.1} height={0.6} pcbX={-1.3} pcbY={0.95} />
    <smtpad portHints={["pin2"]} shape="rect" width={1.1} height={0.6} pcbX={-1.3} pcbY={0} />
    <smtpad portHints={["pin3"]} shape="rect" width={1.1} height={0.6} pcbX={-1.3} pcbY={-0.95} />
    <smtpad portHints={["pin4"]} shape="rect" width={1.1} height={0.6} pcbX={1.3} pcbY={-0.95} />
    <smtpad portHints={["pin5"]} shape="rect" width={1.1} height={0.6} pcbX={1.3} pcbY={0.95} />
    <silkscreenrect width={1.6} height={2.9} />
  </footprint>
}

export function TLV75801PDBVR(props: ChipProps) {
  return <chip {...props}
    manufacturerPartNumber="TLV75801PDBVR"
    pinLabels={regulatorPins}
    schPinArrangement={{leftSide:["IN", "EN"], rightSide:["OUT", "FB"], bottomSide:["GND"]}}
    footprint={<SOT235Footprint />}
    schWidth={1.675} schHeight={0.685}
  />
}

/** 3.3V input; 2.5V analog rail also feeds the 1.1V core LDO. */
export function PowerSupplies({
  pcbX=0, pcbY=0, schX=0, schY=0,
  inputNet="net.V3V3", analogNet="net.V2V5", coreNet="net.V1V1", groundNet="net.GND",
}: {
  pcbX?:number; pcbY?:number; schX?:number; schY?:number;
  inputNet?:string; analogNet?:string; coreNet?:string; groundNet?:string;
}) {
  return <>
    <netlabel net="GND" connection="U2.GND" schX={schX} schY={schY-1} anchorSide="top" />
    <netlabel net="GND" connection="U3.GND" schX={schX+12} schY={schY-1} anchorSide="top" />
    <TLV75801PDBVR name="U2" pcbX={pcbX} pcbY={pcbY} schX={schX} schY={schY} schSheetName="PowerRails" schSectionName="Power"
      pinAttributes={{IN:{requiresPower:true,requiresVoltage:3.3},OUT:{providesPower:true,providesVoltage:2.5},GND:{requiresGround:true}}}
      connections={{IN:inputNet, EN:inputNet, OUT:analogNet, GND:groundNet, FB:"net.FB_2V5"}} />
    <capacitor schRotation={-90} name="C50" capacitance="4.7uF" footprint="0603" maxVoltageRating="10V"
      pcbX={pcbX-4.5} pcbY={pcbY+1} schX={schX-4} schY={schY} schSheetName="PowerRails" schSectionName="Power"
      connections={{pin1:inputNet,pin2:groundNet}} />
    <capacitor schRotation={-90} name="C51" capacitance="10uF" footprint="0805" maxVoltageRating="10V"
      pcbX={pcbX+4.5} pcbY={pcbY+1.3} schX={schX+4} schY={schY} schSheetName="PowerRails" schSectionName="Power"
      connections={{pin1:analogNet,pin2:groundNet}} />
    <resistor schRotation={-90} name="R50" resistance="39k" footprint="0603"
      pcbX={pcbX+4.5} pcbY={pcbY-0.5} schX={schX+3} schY={schY-3} schSheetName="PowerRails" schSectionName="Power"
      connections={{pin1:analogNet,pin2:"net.FB_2V5"}} />
    <resistor schRotation={-90} name="R51" resistance="11k" footprint="0603"
      pcbX={pcbX+4.5} pcbY={pcbY-2} schX={schX+3} schY={schY-5} schSheetName="PowerRails" schSectionName="Power"
      connections={{pin1:"net.FB_2V5",pin2:groundNet}} />
    <TLV75801PDBVR name="U3" pcbX={pcbX} pcbY={pcbY-8} schX={schX+12} schY={schY} schSheetName="PowerRails" schSectionName="Power"
      pinAttributes={{IN:{requiresPower:true,requiresVoltage:2.5},OUT:{providesPower:true,providesVoltage:1.1},GND:{requiresGround:true}}}
      connections={{IN:analogNet, EN:analogNet, OUT:coreNet, GND:groundNet, FB:"net.FB_1V1"}} />
    <capacitor schRotation={-90} name="C52" capacitance="4.7uF" footprint="0603" maxVoltageRating="10V"
      pcbX={pcbX-4.5} pcbY={pcbY-7} schX={schX+5.3} schY={schY} schSheetName="PowerRails" schSectionName="Power"
      connections={{pin1:analogNet,pin2:groundNet}} />
    <capacitor schRotation={-90} name="C53" capacitance="10uF" footprint="0805" maxVoltageRating="10V"
      pcbX={pcbX+4.5} pcbY={pcbY-6.7} schX={schX+16} schY={schY} schSheetName="PowerRails" schSectionName="Power"
      connections={{pin1:coreNet,pin2:groundNet}} />
    <resistor schRotation={-90} name="R52" resistance="10k" footprint="0603"
      pcbX={pcbX+4.5} pcbY={pcbY-8.5} schX={schX+15} schY={schY-3} schSheetName="PowerRails" schSectionName="Power"
      connections={{pin1:coreNet,pin2:"net.FB_1V1"}} />
    <resistor schRotation={-90} name="R53" resistance="10k" footprint="0603"
      pcbX={pcbX+4.5} pcbY={pcbY-10} schX={schX+15} schY={schY-5} schSheetName="PowerRails" schSectionName="Power"
      connections={{pin1:"net.FB_1V1",pin2:groundNet}} />
  </>
}
