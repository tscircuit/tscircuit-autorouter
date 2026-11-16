/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { ResistorProps } from "@tscircuit/props-for-sepic-repro"

export const A_0805W8F200JT5E = (props: Omit<ResistorProps, "resistance">): ReactElement => {
  const { name = "R1", ...restProps } = props

  return (
    <resistor
      name={name}
      resistance="20ohm"
      supplierPartNumbers={{
        jlcpcb: ["C17544"],
      }}
      manufacturerPartNumber="0805W8F200JT5E"
      footprint={
        <footprint>
          <smtpad
            portHints={["pin2"]}
            pcbX="0.999998mm"
            pcbY="0mm"
            width="1.1325352mm"
            height="1.3770102mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin1"]}
            pcbX="-0.999998mm"
            pcbY="0mm"
            width="1.1325352mm"
            height="1.3770102mm"
            shape="rect"
          />
          <silkscreenpath
            route={[
              { x: 0.4761991999999964, y: -0.9170924000000014 },
              { x: 1.7611343999999463, y: -0.9170924000000014 },
              { x: 1.7611343999999463, y: 0.9170924000000014 },
              { x: 0.4761991999999964, y: 0.9170924000000014 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -0.47619920000011007, y: -0.9170924000000014 },
              { x: -1.7611343999999463, y: -0.9170924000000014 },
              { x: -1.7611343999999463, y: 0.9170924000000014 },
              { x: -0.47619920000011007, y: 0.9170924000000014 },
            ]}
          />
          <silkscreentext
            text="{NAME}"
            pcbX="0.0127mm"
            pcbY="1.9144mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <courtyardoutline
            outline={[
              { x: -1.8162655999998378, y: 0.9385051000000431 },
              { x: 1.8162655999998378, y: 0.9385051000000431 },
              { x: 1.8162655999998378, y: -0.9385051000000431 },
              { x: -1.8162655999998378, y: -0.9385051000000431 },
              { x: -1.8162655999998378, y: 0.9385051000000431 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C17544.obj?uuid=c7acac53bcbc44d68fbab8f60a747688",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C17544.step?uuid=c7acac53bcbc44d68fbab8f60a747688",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: 0.000012699999842880061, z: 0 },
      }}
      {...restProps}
    />
  )
}
