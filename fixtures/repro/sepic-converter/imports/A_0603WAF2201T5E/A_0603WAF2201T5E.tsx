/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { ResistorProps } from "@tscircuit/props-for-sepic-repro"

export const A_0603WAF2201T5E = (props: Omit<ResistorProps, "resistance">): ReactElement => {
  const { name = "R1", ...restProps } = props

  return (
    <resistor
      name={name}
      resistance="2.2kohm"
      supplierPartNumbers={{
        jlcpcb: ["C4190"],
      }}
      manufacturerPartNumber="0603WAF2201T5E"
      footprint={
        <footprint>
          <smtpad
            portHints={["pin2"]}
            pcbX="0.753364mm"
            pcbY="0mm"
            width="0.8064754mm"
            height="0.8640064mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin1"]}
            pcbX="-0.753364mm"
            pcbY="0mm"
            width="0.8064754mm"
            height="0.8640064mm"
            shape="rect"
          />
          <silkscreenpath
            route={[
              { x: 0.42621199999996406, y: -0.6606031999999686 },
              { x: 1.3850873999999749, y: -0.6606031999999686 },
              { x: 1.3850873999999749, y: 0.6606031999999686 },
              { x: 0.42621199999996406, y: 0.6606031999999686 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -0.42621200000007775, y: -0.6606031999999686 },
              { x: -1.3850874000000886, y: -0.6606031999999686 },
              { x: -1.3850874000000886, y: 0.6606031999999686 },
              { x: -0.42621200000007775, y: 0.6606031999999686 },
            ]}
          />
          <silkscreentext
            text="{NAME}"
            pcbX="-0.0127mm"
            pcbY="1.6604mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <courtyardoutline
            outline={[
              { x: -1.4066016999998965, y: 0.6820032000000538 },
              { x: 1.4066016999997828, y: 0.6820032000000538 },
              { x: 1.4066016999997828, y: -0.6820032000000538 },
              { x: -1.4066016999998965, y: -0.6820032000000538 },
              { x: -1.4066016999998965, y: 0.6820032000000538 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C4190.obj?uuid=6bd5cd867e9542ebae21caaf5d2d4c4d",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C4190.step?uuid=6bd5cd867e9542ebae21caaf5d2d4c4d",
        pcbRotationOffset: 90,
        modelOriginPosition: { x: -0.004999999999999977, y: 0, z: -0.01 },
      }}
      {...restProps}
    />
  )
}
