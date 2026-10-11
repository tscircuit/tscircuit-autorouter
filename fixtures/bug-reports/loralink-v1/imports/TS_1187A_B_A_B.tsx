import type { PushButtonProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["A"],
  pin2: ["B"],
  pin3: ["C"],
  pin4: ["D"],
} as const

export const TS_1187A_B_A_B = (props: PushButtonProps<typeof pinLabels>) => {
  const { name = "SW1", ...restProps } = props

  return (
    <pushbutton
      name={name}
      pinLabels={pinLabels}
      supplierPartNumbers={{
        jlcpcb: ["C318884"],
      }}
      manufacturerPartNumber="TS-1187A-B-A-B"
      footprint="smdpushbutton4_px6mm_py3.7mm_pw1mm_ph0.75mm"
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C318884.obj?uuid=91b67c1735f643ffb2e7226c23dd3492",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C318884.step?uuid=91b67c1735f643ffb2e7226c23dd3492",
        pcbRotationOffset: 0,
        modelOriginPosition: {
          x: 0.000012700000070253736,
          y: 0.0004999999999999449,
          z: -0.05,
        },
      }}
      {...restProps}
    />
  )
}
