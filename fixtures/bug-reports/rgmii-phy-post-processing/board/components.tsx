import type { ChipProps } from "@tscircuit/props"

// TI SNLS484J pp. 4–9, 131–133, PAP0064M top view.
// All coordinates are mm. Lead centers are ±5.7, 0.5 pitch.
// The exposed-pad copper island is 8x8; mask/paste opening is 4.44x4.44.
// Datasheet: https://www.ti.com/lit/ds/symlink/dp83867ir.pdf
export const dp83867PinLabels = {
  pin1: "RESERVED1",
  pin2: "TD_P_A",
  pin3: "TD_M_A",
  pin4: "VDDA2P5_A",
  pin5: "TD_P_B",
  pin6: "TD_M_B",
  pin7: "RESERVED7",
  pin8: "VDD1P1_8",
  pin9: "RESERVED9",
  pin10: "TD_P_C",
  pin11: "TD_M_C",
  pin12: "VDDA2P5_CD",
  pin13: "TD_P_D",
  pin14: "TD_M_D",
  pin15: "RBIAS",
  pin16: "RESERVED16",
  pin17: "VDDA1P8_17",
  pin18: "XO",
  pin19: "XI",
  pin20: "MDC",
  pin21: "MDIO",
  pin22: "CLK_OUT",
  pin23: "VDDIO_23",
  pin24: "JTAG_TRSTN",
  pin25: "JTAG_CLK",
  pin26: "JTAG_TDO",
  pin27: "JTAG_TMS",
  pin28: "JTAG_TDI",
  pin29: "VDD1P1_29",
  pin30: "TX_CLK",
  pin31: "TX_D7",
  pin32: "TX_D6",
  pin33: "TX_D5",
  pin34: "TX_D4",
  pin35: "TX_D3",
  pin36: "TX_D2",
  pin37: "TX_D1",
  pin38: "TX_D0",
  pin39: "TX_ER",
  pin40: "GTX_CLK",
  pin41: "VDDIO_41",
  pin42: "VDD1P1_42",
  pin43: "RX_CLK",
  pin44: "RX_D0",
  pin45: "RX_D1",
  pin46: "RX_D2",
  pin47: "RX_D3",
  pin48: "RX_D4",
  pin49: "RX_D5",
  pin50: "RX_D6",
  pin51: "RX_D7",
  pin52: "TX_CTRL",
  pin53: "RX_CTRL",
  pin54: "RX_ER",
  pin55: "COL",
  pin56: "CRS",
  pin57: "VDDIO_57",
  pin58: "VDD1P1_58",
  pin59: "RESET_N",
  pin60: "INT_PWDN",
  pin61: "LED_2",
  pin62: "LED_1",
  pin63: "LED_0",
  pin64: "VDDA1P8_64",
  pin65: "GND",
} as const

export function DP83867IRPAP(props: ChipProps) {
  return (
    <chip
      pinLabels={dp83867PinLabels}
      manufacturerPartNumber="DP83867IRPAP"
      noConnect={["RESERVED1", "RESERVED7", "RESERVED9", "RESERVED16", "VDDA1P8_17", "VDDA1P8_64",
        "TX_CLK", "TX_D4", "TX_D5", "TX_D6", "TX_D7", "TX_ER", "RX_D4", "RX_D5", "RX_D6", "RX_D7",
        "RX_ER", "COL", "CRS", "CLK_OUT", "JTAG_TRSTN", "JTAG_CLK", "JTAG_TDO", "JTAG_TMS", "JTAG_TDI", "LED_0", "LED_1", "LED_2"]}
      schWidth={8}
      schHeight={18}
      footprint={
        <footprint>
          {Array.from({ length: 64 }, (_, index) => {
            const pin = index + 1
            const offset = (index % 16) * 0.5 - 3.75
            const side = Math.floor(index / 16)
            return (
              <smtpad
                name={`pad${pin}`}
                portHints={[`pin${pin}`]}
                shape="rect"
                pcbX={side === 0 ? -5.7 : side === 1 ? offset : side === 2 ? 5.7 : -offset}
                pcbY={side === 0 ? -offset : side === 1 ? -5.7 : side === 2 ? offset : 5.7}
                width={side % 2 === 0 ? 1.5 : 0.3}
                height={side % 2 === 0 ? 0.3 : 1.5}
                layer="top"
              />
            )
          })}
          <smtpad name="exposedPad" portHints={["pin65"]} shape="rect"
            pcbX={0} pcbY={0} width={8} height={8} layer="top"
            solderMaskMargin={-1.78} solderPasteMargin={-1.78} />
          {Array.from({ length: 9 }, (_, index) => (
            <via name={`thermal${index + 1}`} connectsTo="net.GND"
              pcbX={(index % 3) - 1} pcbY={Math.floor(index / 3) - 1}
              fromLayer="top" toLayer="bottom" holeDiameter={0.3} outerDiameter={0.6} tented />
          ))}
          <silkscreenpath route={[{x:-4.8,y:4.8},{x:4.8,y:4.8},{x:4.8,y:-4.8},{x:-4.8,y:-4.8},{x:-4.8,y:4.8}]} />
          <silkscreencircle pcbX={-4.3} pcbY={4.3} radius={0.22} />
        </footprint>
      }
      {...props}
    />
  )
}

export const magJackPinLabels = {
  pin1: "CT_C", pin2: "C_N", pin3: "C_P",
  pin4: "B_P", pin5: "B_N", pin6: "CT_B",
  pin7: "CT_D", pin8: "D_P", pin9: "D_N",
  pin10: "A_N", pin11: "A_P", pin12: "CT_A",
  pin13: "SHIELD_1", pin14: "SHIELD_2",
} as const

// Wurth 7499111000A rev003.000 (2023-03-02), pp1–2.
// Manufacturer reference: https://www.we-online.com/components/products/datasheet/7499111000A.pdf
// Default orientation has the cable opening facing +Y.
// Origin is the center of the 32.8x16.6 body. Recommended holes are reproduced.
// Manufacturer gives drills only; copper annuli (1.5/2.6mm) are design choices.
const magJackPads = [
  {pin:1,x:-9.74,y:5.075},{pin:2,x:-9.74,y:3.045},
  {pin:3,x:-9.74,y:1.015},{pin:4,x:-9.74,y:-1.015},
  {pin:5,x:-9.74,y:-3.045},{pin:6,x:-9.74,y:-5.075},
  {pin:7,x:-12.28,y:6.09},{pin:8,x:-12.28,y:4.06},
  {pin:9,x:-12.28,y:2.03},{pin:10,x:-12.28,y:-2.03},
  {pin:11,x:-12.28,y:-4.06},{pin:12,x:-12.28,y:-6.09},
] as const

export function MagJack7499111000A(props: ChipProps<typeof magJackPinLabels>) {
  return (
    <chip pinLabels={magJackPinLabels} manufacturerPartNumber="7499111000A"
      schWidth={2.34} schHeight={1.6}
      footprint={
        <footprint insertionDirection="from_y_pos">
          {magJackPads.map(pad => (
            <platedhole name={`pad${pad.pin}`} shape="circle"
              portHints={[`pin${pad.pin}`]} pcbX={-pad.y} pcbY={pad.x}
              holeDiameter={0.9} outerDiameter={1.5} />
          ))}
          <platedhole name="shieldA" shape="circle" portHints={["pin13"]}
            pcbX={8.065} pcbY={8.68} holeDiameter={1.6} outerDiameter={2.6} />
          <platedhole name="shieldB" shape="circle" portHints={["pin14"]}
            pcbX={-8.065} pcbY={8.68} holeDiameter={1.6} outerDiameter={2.6} />
          <hole name="locatorA" diameter={3.3} pcbX={6.35} pcbY={5.5} />
          <hole name="locatorB" diameter={3.3} pcbX={-6.35} pcbY={5.5} />
          <silkscreenrect pcbX={0} pcbY={0} width={16.6} height={32.8} filled={false} />
        </footprint>
      }
      {...props}
    />
  )
}


