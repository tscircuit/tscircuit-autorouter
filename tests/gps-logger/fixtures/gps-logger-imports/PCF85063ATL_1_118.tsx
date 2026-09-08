import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["OSCI"],
  pin2: ["OSCO"],
  pin3: ["CLKOE"],
  pin4: ["N_INT"],
  pin5: ["VSS"],
  pin6: ["SDA"],
  pin7: ["SCL"],
  pin8: ["NC"],
  pin9: ["CLKOUT"],
  pin10: ["VDD"],
  pin11: ["EP"],
} as const

const pinAttributes = {
  pin5: { requiresGround: true },
  pin8: { doNotConnect: true },
  pin10: { requiresPower: true },
} as const

const footprinterPinLabels = {
  ...pinLabels,
  pin11: [...pinLabels["pin11"], "thermalpad"],
} as const

export const PCF85063ATL_1_118 = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={footprinterPinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
        jlcpcb: ["C404360"],
      }}
      manufacturerPartNumber="PCF85063ATL/1,118"
      footprint="dfn10_thermalpad1.3mmx2.3mm_p0.5mm_w3.01mm_pw0.28mm_pl0.58mm_pin1location(leftside,bottom)"
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C404360.obj?uuid=6b7bf6fa75ed499699f652d45ec1d1be",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C404360.step?uuid=6b7bf6fa75ed499699f652d45ec1d1be",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: 0.000012699999956566899, z: 0 },
      }}
      {...props}
    />
  )
}
