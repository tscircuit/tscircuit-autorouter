/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { InductorProps } from "@tscircuit/props-for-sepic-repro"

export const SRP1265A_470M = (props: Omit<InductorProps, "inductance">): ReactElement => {
  return (
    <inductor
      inductance="47uH"
      supplierPartNumbers={{
        jlcpcb: ["C840530"],
      }}
      manufacturerPartNumber="SRP1265A-470M"
      footprint={
        <footprint>
          <smtpad
            portHints={["pin1"]}
            pcbX="-5.750052mm"
            pcbY="0mm"
            width="3.499993mm"
            height="4.99999mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin2"]}
            pcbX="5.750052mm"
            pcbY="0mm"
            width="3.499993mm"
            height="4.99999mm"
            shape="rect"
          />
          <silkscreenpath
            route={[
              { x: -6.7002405999999155, y: 6.2999620000000505 },
              { x: 6.699732600000061, y: 6.299987399999964 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -6.7002405999999155, y: -6.299961999999937 },
              { x: 6.699732600000061, y: -6.299987399999964 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -6.7002405999999155, y: 6.2999620000000505 },
              { x: -6.7002405999999155, y: 2.7311349999999948 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -6.7002405999999155, y: -2.7311349999999948 },
              { x: -6.7002405999999155, y: -6.299961999999937 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 6.699732600000061, y: -6.299987399999964 },
              { x: 6.699732600000061, y: -2.7311349999999948 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 6.699732600000061, y: 2.7311349999999948 },
              { x: 6.699732600000061, y: 6.299987399999964 },
            ]}
          />
          <silkscreentext
            text="{NAME}"
            pcbX="0.012446mm"
            pcbY="7.3754mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <courtyardoutline
            outline={[
              { x: -7.750048499999934, y: 6.499974800000018 },
              { x: 7.750048499999934, y: 6.499974800000018 },
              { x: 7.750048499999934, y: -6.500000199999931 },
              { x: -7.750048499999934, y: -6.500000199999931 },
              { x: -7.750048499999934, y: 6.499974800000018 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C840530.obj?uuid=b9cef65ce96748059577ce5e642ee887",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C840530.step?uuid=b9cef65ce96748059577ce5e642ee887",
        pcbRotationOffset: 0,
        modelOriginPosition: {
          x: -0.000012699999956566899,
          y: 0.000012699999956566899,
          z: 0,
        },
      }}
      {...props}
    />
  )
}
