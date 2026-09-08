import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["STAT"],
  pin2: ["VSS"],
  pin3: ["VBAT"],
  pin4: ["VDD"],
  pin5: ["PROG"],
} as const

const pinAttributes = {
  pin2: { requiresGround: true },
  pin4: { requiresPower: true },
} as const

export const MCP73831T_2ACI_OT = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
        jlcpcb: ["C424093"],
      }}
      manufacturerPartNumber="MCP73831T-2ACI/OT"
      footprint="dfn6_missing(5)_p0.95mm_w3.47mm_pw0.49mm_pl1.16mm_pin1location(leftside,bottom)"
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C424093.obj?uuid=460193f9bf2d42e58cf3c2f675b07dc6",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C424093.step?uuid=460193f9bf2d42e58cf3c2f675b07dc6",
        pcbRotationOffset: 90,
        modelOriginPosition: {
          x: 0.004489450000050965,
          y: 0.000012700000070253736,
          z: -0.049083,
        },
      }}
      {...props}
    />
  )
}
