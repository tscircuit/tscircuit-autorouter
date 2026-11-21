/** @jsxImportSource react-for-pipeline9-fixtures */
import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["DEC1"],
  pin2: ["P0_00","XL1"],
  pin3: ["P0_01","XL2"],
  pin4: ["P0_02","AIN0"],
  pin5: ["P0_03","AIN1"],
  pin6: ["P0_04","AIN2"],
  pin7: ["P0_05","AIN3"],
  pin8: ["P0_06"],
  pin9: ["P0_07"],
  pin10: ["P0_08"],
  pin11: ["P0_09","NFC1"],
  pin12: ["P0_10","NFC2"],
  pin13: ["VDD1"],
  pin14: ["P0_11"],
  pin15: ["P0_12"],
  pin16: ["P0_13"],
  pin17: ["P0_14","TRACE3"],
  pin18: ["P0_15","TRACE2"],
  pin19: ["P0_16","TRACE1"],
  pin20: ["P0_17"],
  pin21: ["P0_18","TRACEDATA_0_","SWO"],
  pin22: ["P0_19"],
  pin23: ["P0_20","TRACECLK"],
  pin24: ["P0_21","RESET"],
  pin25: ["SWDCLK"],
  pin26: ["SWDIO"],
  pin27: ["P0_22"],
  pin28: ["P0_23"],
  pin29: ["P0_24"],
  pin30: ["ANT"],
  pin31: ["VSS1"],
  pin32: ["DEC2"],
  pin33: ["DEC3"],
  pin34: ["XC1"],
  pin35: ["XC2"],
  pin36: ["VDD2"],
  pin37: ["P0_25"],
  pin38: ["P0_26"],
  pin39: ["P0_27"],
  pin40: ["P0_28","AIN4"],
  pin41: ["P0_29","AIN5"],
  pin42: ["P0_30","AIN6"],
  pin43: ["P0_31","AIN7"],
  pin44: ["NC"],
  pin45: ["VSS2"],
  pin46: ["DEC4"],
  pin47: ["DCC"],
  pin48: ["VDD3"],
  pin49: ["EP"]
} as const

const pinAttributes = {
  pin13: {requiresPower: true},
  pin36: {requiresPower: true},
  pin48: {requiresPower: true},
  pin49: {requiresGround: true},
  pin31: {requiresGround: true},
  pin44: {doNotConnect: true},
  pin45: {requiresGround: true}
} as const

export const NRF52832_QFAA_R = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
  "jlcpcb": [
    "C77540"
  ]
}}
      manufacturerPartNumber="NRF52832-QFAA-R"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-2.199894mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-1.800098mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-1.400048mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="-0.999998mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="-0.599948mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin6"]} pcbX="-0.199898mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin7"]} pcbX="0.199898mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin8"]} pcbX="0.599948mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin9"]} pcbX="0.999998mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin10"]} pcbX="1.400048mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin11"]} pcbX="1.800098mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin12"]} pcbX="2.199894mm" pcbY="-2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin13"]} pcbX="2.907538mm" pcbY="-2.199894mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin14"]} pcbX="2.907538mm" pcbY="-1.800098mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin15"]} pcbX="2.907538mm" pcbY="-1.400048mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin16"]} pcbX="2.907538mm" pcbY="-0.999998mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin17"]} pcbX="2.907538mm" pcbY="-0.599948mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin18"]} pcbX="2.907538mm" pcbY="-0.199898mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin19"]} pcbX="2.907538mm" pcbY="0.199898mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin20"]} pcbX="2.907538mm" pcbY="0.599948mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin21"]} pcbX="2.907538mm" pcbY="0.999998mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin22"]} pcbX="2.907538mm" pcbY="1.400048mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin23"]} pcbX="2.907538mm" pcbY="1.800098mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin24"]} pcbX="2.907538mm" pcbY="2.199894mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin25"]} pcbX="2.199894mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin26"]} pcbX="1.800098mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin27"]} pcbX="1.400048mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin28"]} pcbX="0.999998mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin29"]} pcbX="0.599948mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin30"]} pcbX="0.199898mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin31"]} pcbX="-0.199898mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin32"]} pcbX="-0.599948mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin33"]} pcbX="-0.999998mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin34"]} pcbX="-1.400048mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin35"]} pcbX="-1.800098mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin36"]} pcbX="-2.199894mm" pcbY="2.907538mm" width="0.1999996mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin37"]} pcbX="-2.907538mm" pcbY="2.199894mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin38"]} pcbX="-2.907538mm" pcbY="1.800098mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin39"]} pcbX="-2.907538mm" pcbY="1.400048mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin40"]} pcbX="-2.907538mm" pcbY="0.999998mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin41"]} pcbX="-2.907538mm" pcbY="0.599948mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin42"]} pcbX="-2.907538mm" pcbY="0.199898mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin43"]} pcbX="-2.907538mm" pcbY="-0.199898mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin44"]} pcbX="-2.907538mm" pcbY="-0.599948mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin45"]} pcbX="-2.907538mm" pcbY="-0.999998mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin46"]} pcbX="-2.907538mm" pcbY="-1.400048mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin47"]} pcbX="-2.907538mm" pcbY="-1.800098mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin48"]} pcbX="-2.907538mm" pcbY="-2.199894mm" width="0.6649974mm" height="0.1999996mm" shape="rect" />
<smtpad portHints={["pin49"]} pcbX="0mm" pcbY="0mm" width="3.7999924mm" height="3.7999924mm" shape="rect" />
<via connectsTo="net.GND" pcbX="-0.499872mm" pcbY="0.499872mm" outerDiameter="0.6096mm" holeDiameter="0.3048mm" layers={["top","bottom"]} />
<via connectsTo="net.GND" pcbX="0.500126mm" pcbY="0.499872mm" outerDiameter="0.6096mm" holeDiameter="0.3048mm" layers={["top","bottom"]} />
<via connectsTo="net.GND" pcbX="-0.499872mm" pcbY="-0.500126mm" outerDiameter="0.6096mm" holeDiameter="0.3048mm" layers={["top","bottom"]} />
<via connectsTo="net.GND" pcbX="0.500126mm" pcbY="-0.500126mm" outerDiameter="0.6096mm" holeDiameter="0.3048mm" layers={["top","bottom"]} />
<silkscreenpath route={[{"x":-3.0761939999999868,"y":2.5025096000001668},{"x":-3.0761939999999868,"y":3.0761939999999868},{"x":-2.502509600000053,"y":3.0761939999999868}]} />
<silkscreenpath route={[{"x":3.076193999999873,"y":2.5025096000001668},{"x":3.076193999999873,"y":3.0761939999999868},{"x":2.5025095999999394,"y":3.0761939999999868}]} />
<silkscreenpath route={[{"x":-3.0761939999999868,"y":-2.502509600000053},{"x":-3.0761939999999868,"y":-3.0761939999999868},{"x":-2.502509600000053,"y":-3.0761939999999868}]} />
<silkscreenpath route={[{"x":3.076193999999873,"y":-2.502509600000053},{"x":3.076193999999873,"y":-3.0761939999999868},{"x":2.5025095999999394,"y":-3.0761939999999868}]} />
<silkscreencircle pcbX="-2.199894mm" pcbY="-3.539998mm" radius="0.07493mm" />
<silkscreentext text="{NAME}" pcbX="-6.8mm" pcbY="1.7mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-3.4900367000000188,"y":3.4900367000000188},{"x":3.490036699999905,"y":3.4900367000000188},{"x":3.490036699999905,"y":-3.4900367000000188},{"x":-3.4900367000000188,"y":-3.4900367000000188},{"x":-3.4900367000000188,"y":3.4900367000000188}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C77540.obj?uuid=bdd2e424ca814172a2a3360611c5d9d7",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C77540.step?uuid=bdd2e424ca814172a2a3360611c5d9d7",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0.000012700000070253736, y: 0, z: 0 },
      }}
      {...props}
    />
  )
}