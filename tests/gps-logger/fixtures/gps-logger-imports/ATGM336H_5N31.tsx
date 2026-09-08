import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["GND1"],
  pin2: ["TXD"],
  pin3: ["RXD"],
  pin4: ["1PPS"],
  pin5: ["pin5"],
  pin6: ["VBAT"],
  pin7: ["NC1"],
  pin8: ["VCC"],
  pin9: ["NRESET"],
  pin10: ["GND2"],
  pin11: ["RF_IN"],
  pin12: ["GND3"],
  pin13: ["NC2"],
  pin14: ["VCC_RF"],
  pin15: ["Reserved1"],
  pin16: ["SDA"],
  pin17: ["SCL"],
  pin18: ["Reserved2"],
} as const

const pinAttributes = {
  pin1: { requiresGround: true },
  pin7: { doNotConnect: true },
  pin8: { requiresPower: true },
  pin10: { requiresGround: true },
  pin12: { requiresGround: true },
  pin13: { doNotConnect: true },
} as const

export const ATGM336H_5N31 = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
        jlcpcb: ["C90770"],
      }}
      manufacturerPartNumber="ATGM336H-5N31"
      footprint="dfn18_pillpads_p1.1mm_w11.39mm_pw0.7mm_pl1.77mm_pin1location(rightside,top)"
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C90770.obj?uuid=3a9b92849d9d4e12aff81024b0dce41f",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C90770.step?uuid=3a9b92849d9d4e12aff81024b0dce41f",
        pcbRotationOffset: 90,
        modelOriginPosition: {
          x: -0.000038099999983387534,
          y: -0.00003810000009707437,
          z: 0,
        },
      }}
      {...props}
    />
  )
}
