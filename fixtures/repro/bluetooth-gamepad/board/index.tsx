/** @jsxImportSource react-for-pipeline9-fixtures */
import React from "react-for-pipeline9-fixtures"
import { NRF52832_QFAA_R } from "./imports/NRF52832_QFAA_R"
import { RKJXV122400R } from "./imports/RKJXV122400R"
import { PTS810SJG250SMTRLFS } from "./imports/PTS810SJG250SMTRLFS"
import { A_8Y32000004 } from "./imports/A_8Y32000004"

// Right half of the hand-held outline. Sample cubic curves so the grip and
// shoulder radii remain smooth in both fabrication output and the PCB viewer.
type XY = [number, number]
const rightEdge: XY[] = [[0, 29]]
function curve(a: XY, b: XY, end: XY) {
  const start = rightEdge[rightEdge.length - 1]
  for (let i = 1; i <= 10; i++) {
    const t = i / 10, s = 1 - t
    rightEdge.push([0, 1].map(k =>
      s ** 3 * start[k] + 3 * s ** 2 * t * a[k] + 3 * s * t ** 2 * b[k] + t ** 3 * end[k]
    ) as XY)
  }
}
curve([20, 29], [26, 32], [43, 32])
curve([60, 32], [64, 24], [66, 9])
curve([68, -4], [71, -21], [70, -28])
curve([69, -40], [60, -42], [53, -37])
curve([45, -31], [43, -20], [33, -20])
curve([20, -20], [12, -17], [0, -17])
const outline = [...rightEdge, ...rightEdge.slice(1, -1).reverse().map(([x, y]) => [-x, y])]
  .map(([x, y]) => ({ x, y }))

// Switches use the SoC's pull-ups. The two wired corners on each tactile
// switch are diagonally opposite. All controls are active low.
const buttons = [
  { net: "UP",     gpio: 40, x: -47, y: 20 },
  { net: "DOWN",   gpio: 41, x: -47, y: 4 },
  { net: "LEFT",   gpio: 42, x: -55, y: 12 },
  { net: "RIGHT",  gpio: 43, x: -39, y: 12 },
  { net: "A",      gpio: 17, x: 47, y: 4 },
  { net: "B",      gpio: 18, x: 55, y: 12 },
  { net: "X",      gpio: 19, x: 39, y: 12 },
  { net: "Y",      gpio: 20, x: 47, y: 20 },
  { net: "SELECT", gpio: 8,  x: -8, y: -2 },
  { net: "START",  gpio: 9,  x: 8, y: -2 },
] as const

function nets(name: string, pins: Record<number, string>) {
  return Object.entries(pins).map(([pin, net]) =>
    <trace key={name + pin} from={name + ".pin" + pin} to={"net." + net} />)
}

function silk(text: string, x: number, y: number, size = 1.35) {
  return <silkscreentext text={text} pcbX={x} pcbY={y} fontSize={size} anchorAlignment="center" />
}

// Nordic nRF52832 QFAA internal LDO reference (PS v1.9, section 53.1).
// LFCLK uses the calibrated internal RC oscillator. DEC2 and DCC are NC.
const bypass = [
  { name: "C1", value: "12pF",   net: "XC1",  x: -5.8, y: 18.95, rot: 180 },
  { name: "C2", value: "12pF",   net: "XC2",  x: -3.1, y: 22.7, rot: 0 },
  { name: "C4", value: "100nF",  net: "DEC1", x: -2.2, y: 9.2,  rot: 270 },
  { name: "C5", value: "100nF",  net: "VDD",  x: 4.7,  y: 11.8, rot: 0 },
  { name: "C7", value: "100pF",  net: "DEC3", x: -1.72,y: 18.88, rot: 0 },
  { name: "C8", value: "100nF",  net: "VDD",  x: -4.9, y: 17.2, rot: 180 },
  { name: "C9", value: "4.7uF",  net: "VDD",  x: -5.6, y: 11.8, rot: 180 },
  { name: "C10",value: "1uF",    net: "DEC4", x: -5.6, y: 13.4, rot: 180 },
]

function Radio() {
  const supplyAndIO: Record<number, string> = {
    1:"DEC1", 4:"LX", 5:"LY", 6:"RX", 7:"RY", 10:"L3", 14:"R3",
    13:"VDD", 36:"VDD", 48:"VDD", 31:"GND", 45:"GND", 49:"GND",
    24:"RESET", 25:"SWDCLK", 26:"SWDIO", 33:"DEC3", 34:"XC1", 35:"XC2", 46:"DEC4",
  }
  for (const b of buttons) supplyAndIO[b.gpio] = b.net
  return <schematicsection name="Radio" displayName="Bluetooth LE radio and clock">
    <NRF52832_QFAA_R name="U1" pcbX={0} pcbY={14} schX={0} schY={0} />
    {nets("U1", supplyAndIO)}
    <A_8Y32000004 name="Y1" loadCapacitance="8pF" pcbX={-4.1} pcbY={20.8} schX={9} schY={4} />
    {nets("Y1", {1:"XC1", 2:"GND", 3:"XC2", 4:"GND"})}
    {bypass.map((c, i) => <React.Fragment key={c.name}>
      <capacitor name={c.name} capacitance={c.value} footprint={["C9", "C10"].includes(c.name) ? "0603" : "0402"}
        pcbX={c.x} pcbY={c.y} pcbRotation={c.rot} schX={6 + (i % 4) * 3} schY={-1 - 3 * Math.floor(i / 4)} />
      {nets(c.name, {1:c.net, 2:"GND"})}
    </React.Fragment>)}
    <capacitor name="C3" capacitance="0.8pF" footprint="0402" pcbX={0.71} pcbY={18.45} pcbRotation={0} schX={7} schY={8} />
    <inductor name="L1" inductance="3.9nH" footprint="0402" pcbX={0.2} pcbY={20.18} pcbRotation={90} schX={10} schY={8} />
    <chip name="J1" manufacturerPartNumber="U.FL-R-SMT-1(10)" pcbX={0.2} pcbY={23.9} schX={14} schY={8}
      pinLabels={{pin1:"RF", pin2:"GND_L", pin3:"GND_R"}}
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX={0} pcbY={-1.525} width={1} height={1.05} shape="rect" />
        {[-1.475,1.475].map((x,i) => <smtpad key={i} portHints={["pin"+(i+2)]} pcbX={x} pcbY={0} width={1.05} height={2.2} shape="rect" />)}
        <silkscreencircle radius={1.15} />
      </footprint>} />
    <trace from="U1.pin30" to="C3.pin1" pcbStraightLine thickness={0.2} />
    <trace from="C3.pin1" to="L1.pin1" pcbStraightLine thickness={0.25} />
    <trace from="L1.pin2" to="J1.pin1" pcbStraightLine thickness={0.32} />
    {nets("J1",{2:"GND",3:"GND"})}
    {nets("C3",{2:"GND"})}
    {silk("ANT 2.4 GHz", 1, 26.4, 1)}
  </schematicsection>
}

function Controls() {
  return <schematicsection name="Controls" displayName="Thumbsticks and controls">
    {(["L","R"] as const).map((side, i) => {
      const name = "JS" + (i+1), x = i ? 28 : -28
      return <React.Fragment key={name}>
        <RKJXV122400R name={name} pcbX={x} pcbY={-6} schX={-13 + i*5} schY={8} />
        {nets(name, {1:"GND",2:side+"Y",3:"VDD",4:"VDD",5:side+"X",6:"GND",
          7:"GND",8:"GND",9:"GND",10:"GND",11:side+"3",14:"GND"})}
        {silk(side === "L" ? "L3" : "R3",x,6.5)}
      </React.Fragment>
    })}
    {buttons.map((b,i) => {
      const name = "SW" + (i+1)
      return <React.Fragment key={name}>
        <PTS810SJG250SMTRLFS name={name} pcbX={b.x} pcbY={b.y} schX={-14+(i%3)*3.3} schY={3-2.5*Math.floor(i/3)} />
        {nets(name, {1:b.net,4:"GND"})}
        {silk(b.net,b.x,b.y-3.3)}
      </React.Fragment>
    })}
  </schematicsection>
}

export default function Gamepad() {
  return <board title="Dual-stick BLE gamepad" outline={outline} layers={4} thickness={1.6}
    isViaInPadAllowed solderMaskColor="blue" minTraceWidth={0.16} minTraceToPadEdgeClearance={0.14}
    minPadEdgeToPadEdgeClearance={0.14} minViaPadDiameter={0.6} minViaHoleDiameter={0.3}>
    <schematicsheet name="Controller" displayName="Dual-stick BLE controller">
      <Radio />
      <Controls />
      <schematicsection name="Service" displayName="Power and programming">
        <pinheader name="J2" pinCount={2} pitch={2.54} gender="male" pcbX={-15} pcbY={24} schX={-11} schY={-9} />
        {nets("J2",{1:"VDD",2:"GND"})}
        <pinheader name="J3" pinCount={5} pitch={2.54} gender="male" pcbX={16} pcbY={24} schX={-5} schY={-9} />
        {nets("J3",{1:"VDD",2:"SWDIO",3:"SWDCLK",4:"RESET",5:"GND"})}
      </schematicsection>
    </schematicsheet>
    <copperpour name="GroundPlane" layer="inner1" connectsTo="net.GND" clearance={0.25} boardEdgeMargin={0.5} unbroken />
    {silk("2 x AAA", -15, 28, 1.1)}
    {silk("+    -", -15, 21, 1.2)}
    {silk("VT  IO  CK  RST  G", 16, 21, 0.9)}
    {silk("SWD",16,27.6,1.1)}
    {silk("DUAL ANALOG",0,-10,2.0)}
    {silk("BLE GAMEPAD   /   REV A",0,-13,0.95)}
    {[[-57,25],[57,25],[-61,-27],[61,-27]].map(([x,y],i) =>
      <hole key={i} name={"H"+(i+1)} pcbX={x} pcbY={y} diameter={3.2} />)}
  </board>
}
