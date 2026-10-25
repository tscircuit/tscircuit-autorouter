import { DP83867IRPAP, MagJack7499111000A } from "./components"
import { PowerSupplies } from "./power"

export const txSignals = ["TX_D0", "TX_D1", "TX_D2", "TX_D3", "TX_CTRL", "GTX_CLK"]
export const rxSignals = ["RX_D0", "RX_D1", "RX_D2", "RX_D3", "RX_CTRL", "RX_CLK"]
export const hostSignals = [...txSignals, ...rxSignals, "MDC", "MDIO", "RESET_N", "INT_PWDN"]

const supplyPins = [
  { pin: 4, rail: "V2_5", x: 4, y: -3.5 },
  { pin: 12, rail: "V2_5", x: 4, y: 3.5 },
  { pin: 8, rail: "V1_1", x: 4, y: 0 },
  { pin: 23, rail: "V3_3", x: -6, y: 8 },
  { pin: 29, rail: "V1_1", x: -10, y: 8 },
  { pin: 41, rail: "V3_3", x: -14, y: 0 },
  { pin: 42, rail: "V1_1", x: -14, y: -3.5 },
  { pin: 57, rail: "V3_3", x: -9, y: -8 },
  { pin: 58, rail: "V1_1", x: -5, y: -8 },
]

// The PAP core supply is 1.1V. Both VDDA1P8 pins stay completely open.
export default function RgmiiPhyBoard() {
  return (
    <board title="RGMII PHY companion — DP83867IRPAP" width={90} height={70}
      layers={4} thickness={1.6} borderRadius={2} solderMaskColor="green"
      minTraceWidth={0.15} defaultTraceWidth={0.18}
      minTraceToPadEdgeClearance={0.15} minPadEdgeToPadEdgeClearance={0.15}
      minViaHoleDiameter={0.3} minViaPadDiameter={0.6} isViaInPadAllowed
      autorouter="auto-local" schMaxTraceDistance={3} schTraceAutoLabelEnabled>
      <schematicsheet name="Main" displayName="PHY and FPGA interface">
        <schematicsection name="host" displayName="3.3V FPGA interface" />
        <schematicsection name="phy" displayName="DP83867IRPAP — PHY address 0" />
        <schematicsection name="support" displayName="Support" sectionTitleFontSize={0.16} />
        <schematicsection name="ethernet" displayName="Isolated Gigabit MagJack — no PoE" />
      </schematicsheet>
      <schematicsheet name="PowerRails" displayName="Power supplies">
        <schematicsection name="Power" displayName="3.3V input / 2.5V analog / 1.1V core" />
      </schematicsheet>
      <schematicsheet name="Decoupling" displayName="PHY supply decoupling" />
      <net name="GND" isGroundNet />
      <net name="V3_3" isPowerNet nominalTraceWidth={0.4} />
      <net name="V2_5" isPowerNet nominalTraceWidth={0.35} />
      <net name="V1_1" isPowerNet nominalTraceWidth={0.4} />
      <net name="CHASSIS" />

      <chip name="J1" manufacturerPartNumber="2x20 2.54mm FPGA interface"
        pinAttributes={{pin33:{providesPower:true,providesVoltage:3.3},pin35:{providesPower:true,providesVoltage:3.3},pin2:{providesGround:true}}}
        pcbX={-36} pcbY={0} schX={-12} schY={0} schSheetName="Main" schSectionName="host"
        schWidth={2.625} schHeight={4.2}
        pinLabels={Object.fromEntries(Array.from({length:40},(_,i)=>[
          `pin${i+1}`,i%2===1 ? `GND_${i+1}` : hostSignals[i/2] ?? (i<36 ? `V3_3_${i+1}` : `GND_${i+1}`),
        ]))}
        footprint={<footprint>
          {Array.from({length:40},(_,i)=><platedhole
            portHints={[`pin${i+1}`]} shape="circle" holeDiameter={1} outerDiameter={1.7}
            pcbX={i%2===0 ? 1.27 : -1.27} pcbY={24.13-Math.floor(i/2)*2.54} />)}
          <silkscreenrect pcbX={0} pcbY={0} width={5.2} height={51.1} />
        </footprint>} />
      {Array.from({length:20},(_,i)=><trace key={`jg${i}`} from={`J1.pin${i*2+2}`} to="net.GND" />)}
      {[33,35].map(pin=><trace key={String(pin)} from={`J1.pin${pin}`} to="net.V3_3" />)}
      {[37,39].map(pin=><trace key={String(pin)} from={`J1.pin${pin}`} to="net.GND" />)}
      <DP83867IRPAP name="U1" pcbX={-5} pcbY={0} pcbRotation={180}
        pinAttributes={{...Object.fromEntries(supplyPins.map(({pin,rail})=>[`pin${pin}`,{
          requiresPower:true,requiresVoltage:rail==="V3_3" ? 3.3 : rail==="V2_5" ? 2.5 : 1.1,
          requiredVoltageTolerance:"5%",mustBeConnected:true,
        }])),GND:{requiresGround:true,mustBeConnected:true}}}
        schX={0} schY={0} schSheetName="Main" schSectionName="phy" schWidth={2.625} schHeight={6.7}
        schPinArrangement={{
          leftSide:{direction:"top-to-bottom",pins:[...hostSignals,"TX_CLK","TX_D4","TX_D5","TX_D6","TX_D7","TX_ER"]},
          rightSide:{direction:"top-to-bottom",pins:["TD_P_A","TD_M_A","TD_P_B","TD_M_B","TD_P_C","TD_M_C","TD_P_D","TD_M_D","XI","XO","RBIAS","LED_0","LED_1","LED_2","CLK_OUT","RX_D4","RX_D5","RX_D6","RX_D7","RX_ER","COL","CRS"]},
          topSide:{direction:"left-to-right",pins:[...supplyPins.map(p=>`pin${p.pin}`),"VDDA1P8_17","VDDA1P8_64"]},
          bottomSide:{direction:"left-to-right",pins:["GND","RESERVED1","RESERVED7","RESERVED9","RESERVED16","JTAG_TRSTN","JTAG_CLK","JTAG_TDO","JTAG_TMS","JTAG_TDI"]},
        }} />
      <trace from="U1.GND" to="net.GND" />
      {hostSignals.map((signal,i)=><trace key={signal} name={signal}
        from={`J1.pin${i*2+1}`} to={`U1.${signal}`} schDisplayLabel={signal} />)}
      <bus name="RGMII_TX" connections={txSignals} maxLengthSkew={0.5}
        pcbTraceWidth={0.18} targetImpedance={50} pcbAllowedLayers={["top","bottom"]} />
      <bus name="RGMII_RX" connections={rxSignals} maxLengthSkew={0.5}
        pcbTraceWidth={0.18} targetImpedance={50} pcbAllowedLayers={["top","bottom"]} />
      <PowerSupplies pcbX={-21} pcbY={25} schX={-12} schY={-20}
        inputNet="net.V3_3" analogNet="net.V2_5" coreNet="net.V1_1" />
      <capacitor name="C60" capacitance="10uF" footprint="0805" maxVoltageRating="10V"
        pcbX={-27} pcbY={-23} schX={-14.8} schY={-20} schRotation={-90} schSheetName="PowerRails" schSectionName="Power"
        connections={{pin1:"net.V3_3",pin2:"net.GND"}} />
      {["V3_3","V2_5","V1_1"].map((rail,i)=><capacitor name={`C${61+i}`}
        capacitance="10nF" footprint="0603" maxVoltageRating="10V"
        pcbX={-23+i*4} pcbY={-23} pcbRotation={i===2 ? 180 : 0}
        schX={[-17.2,-5.4,5.3][i]} schY={-20}
        schRotation={-90} schSheetName="PowerRails" schSectionName="Power" connections={{pin1:`net.${rail}`,pin2:"net.GND"}} />)}
      {supplyPins.map(({pin,rail,x,y},i)=><>
        <capacitor schRotation={-90} name={`C${i*2+1}`} capacitance="100nF" footprint="0603"
          pcbX={x} pcbY={y} layer="bottom" schX={supplyPins.slice(0,i).filter(p=>p.rail===rail).length*2.4} schY={["V2_5","V1_1","V3_3"].indexOf(rail)*-4} schSheetName="Decoupling"
          connections={{pin1:`net.${rail}`,pin2:"net.GND"}} />
        <capacitor schRotation={-90} name={`C${i*2+2}`} capacitance="1uF" footprint="0603"
          pcbX={x} pcbY={y-1.8} layer="bottom" schX={supplyPins.slice(0,i).filter(p=>p.rail===rail).length*2.4+1.2} schY={["V2_5","V1_1","V3_3"].indexOf(rail)*-4} schSheetName="Decoupling"
          connections={{pin1:`net.${rail}`,pin2:"net.GND"}} />
        <trace from={`U1.pin${pin}`} to={`net.${rail}`} />
      </>)}
      <crystal name="Y1" frequency="25MHz" loadCapacitance="18pF"
        manufacturerPartNumber="ABM8-25.000MHZ-B2-T" pinVariant="four_pin"
        pcbX={-3} pcbY={9.5} schX={-8} schY={12} schSheetName="Main" schSectionName="support"
        footprint={<footprint>
          {[[-1.15,-0.875],[1.15,-0.875],[1.15,0.875],[-1.15,0.875]].map(([x,y],i)=><smtpad
            portHints={[`pin${i+1}`]} shape="rect" width={1.3} height={1.05} pcbX={x} pcbY={y} layer="top" />)}
        </footprint>}
        connections={{pin1:"U1.XI",pin3:"U1.XO",pin2:"net.GND",pin4:"net.GND"}} />
      {[{n:19,pin:"XI",x:-7},{n:20,pin:"XO",x:1}].map(({n,pin,x},i)=><capacitor schRotation={-90} key={n}
        name={`C${n}`} capacitance="27pF" footprint="0603"
        pcbX={x} pcbY={10.5} schX={-11+i*6} schY={15} schSheetName="Main" schSectionName="support"
        connections={{pin1:`U1.${pin}`,pin2:"net.GND"}} />)}
      <resistor schRotation={-90} name="R1" resistance="11k" footprint="0603" pcbX={3} pcbY={-7}
        schX={0} schY={10} schSheetName="Main" schSectionName="support" connections={{pin1:"U1.RBIAS",pin2:"net.GND"}} />
      <resistor schRotation={-90} name="R2" resistance="5.76k" footprint="0603" pcbX={-2} pcbY={-13}
        schX={5} schY={15} schSheetName="Main" schSectionName="support" connections={{pin1:"net.V3_3",pin2:"U1.RX_CTRL"}} />
      <resistor schRotation={-90} name="R3" resistance="2.49k" footprint="0603" pcbX={-2} pcbY={-16}
        schX={5} schY={11} schSheetName="Main" schSectionName="support" connections={{pin1:"U1.RX_CTRL",pin2:"net.GND"}} />
      <resistor schRotation={-90} name="R4" resistance="2.2k" footprint="0603" pcbX={-18} pcbY={12}
        schX={10} schY={15} schSheetName="Main" schSectionName="support" connections={{pin1:"net.V3_3",pin2:"U1.MDIO"}} />
      <resistor schRotation={-90} name="R5" resistance="10k" footprint="0603" pcbX={-16} pcbY={-16}
        schX={10} schY={11} schSheetName="Main" schSectionName="support" connections={{pin1:"net.V3_3",pin2:"U1.RESET_N"}} />
      <resistor schRotation={-90} name="R6" pcbRotation={180} resistance="2.2k" footprint="0603" pcbX={-20} pcbY={-16}
        schX={15} schY={11} schSheetName="Main" schSectionName="support" connections={{pin1:"net.V3_3",pin2:"U1.INT_PWDN"}} />
      <MagJack7499111000A name="J2" pcbX={28.6} pcbY={0} pcbRotation={-90}
        schX={11} schY={0} schSheetName="Main" schSectionName="ethernet" />
      {["A","B","C","D"].map(pair=><>
        <trace name={`MDI_${pair}_P`} from={`U1.TD_P_${pair}`} to={`J2.${pair}_P`} />
        <trace name={`MDI_${pair}_N`} from={`U1.TD_M_${pair}`} to={`J2.${pair}_N`} />
        <differentialpair name={`MDI_${pair}`} positiveConnection={`MDI_${pair}_P`}
          negativeConnection={`MDI_${pair}_N`} maxLengthSkew={0.127}
          targetDifferentialImpedance={100} pcbTraceGap={0.2} maxUncoupledLength={3} />
      </>)}
      {["A","B","C","D"].map((pair,i)=><capacitor schRotation={-90} key={pair} name={`C${21+i}`}
        capacitance="100nF" footprint="0603" pcbX={9} pcbY={9-i*6}
        schX={8+i*1.4} schY={-4} schSheetName="Main" schSectionName="ethernet"
        connections={{pin1:`J2.CT_${pair}`,pin2:"net.GND"}} />)}
      <trace from="J2.SHIELD_1" to="net.CHASSIS" />
      <trace from="J2.SHIELD_2" to="net.CHASSIS" />
      <copperpour name="GND_L2" layer="inner1" connectsTo="net.GND" unbroken
        outline={[{x:-43,y:-33},{x:12,y:-33},{x:12,y:33},{x:-43,y:33}]} />
      <copperpour name="GND_L3" layer="inner2" connectsTo="net.GND" unbroken
        outline={[{x:-43,y:-33},{x:12,y:-33},{x:12,y:33},{x:-43,y:33}]} />
      {[[-41,-30],[-41,30],[40,-30],[40,30]].map(([x,y],i)=><hole name={`H${i+1}`} diameter={3.2} pcbX={x} pcbY={y} />)}
      <silkscreentext text="RGMII / DP83867" pcbX={0} pcbY={29} fontSize={1.5} />
      <silkscreentext text="3.3V FPGA IO ONLY" pcbX={-13} pcbY={-30} fontSize={1} />
      <silkscreentext text="REV A — ENGINEERING PROTOTYPE" pcbX={0} pcbY={-33} fontSize={0.8} />
    </board>
  )
}
