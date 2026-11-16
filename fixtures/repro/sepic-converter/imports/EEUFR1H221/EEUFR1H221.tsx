/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { CapacitorProps } from "@tscircuit/props-for-sepic-repro"

export const EEUFR1H221 = (
  props: Omit<CapacitorProps, "capacitance">,
): ReactElement => {
  const { name = "C1", ...restProps } = props

  return (
    <capacitor
      name={name}
      capacitance="220uF"
      polarized
      supplierPartNumbers={{
        jlcpcb: ["C407949"],
      }}
      manufacturerPartNumber="EEUFR1H221"
      footprint={
        <footprint>
          <platedhole
            portHints={["pin1"]}
            pcbX="-2.54mm"
            pcbY="0mm"
            outerDiameter="1.5999968mm"
            holeDiameter="0.999998mm"
            shape="circle"
          />
          <platedhole
            portHints={["pin2"]}
            pcbX="2.54mm"
            pcbY="0mm"
            outerDiameter="1.5999968mm"
            holeDiameter="0.999998mm"
            shape="circle"
          />
          <silkscreenpath
            route={[
              { x: -4.572000000000003, y: 0 },
              { x: -3.5559999999999974, y: 0 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -4.064000000000007, y: 0.7620000000000005 },
              { x: -4.064000000000007, y: -0.7619999999999862 },
            ]}
          />
          <silkscreencircle pcbX="0mm" pcbY="0mm" radius="4.99999mm" />
          <silkscreentext
            text="{NAME}"
            pcbX="0.0254mm"
            pcbY="6.0038mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <fabricationnotepath
            route={[
              { x: -2.539999999999992, y: -1.0159999999999911 },
              { x: -0.7620000000000005, y: -1.0159999999999911 },
              { x: -0.7620000000000005, y: -1.269999999999996 },
              { x: -2.539999999999992, y: -1.269999999999996 },
              { x: -2.539999999999992, y: -1.0159999999999911 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <fabricationnotepath
            route={[
              { x: -1.7779999999999916, y: -0.7620000000000005 },
              { x: -1.7779999999999916, y: -2.0319999999999965 },
              { x: -1.524000000000001, y: -2.0319999999999965 },
              { x: -1.524000000000001, y: -0.2539999999999907 },
              { x: -1.7779999999999916, y: -0.2539999999999907 },
              { x: -1.7779999999999916, y: -0.7620000000000005 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <courtyardoutline
            outline={[
              { x: -5.254993799999994, y: 5.2149888 },
              { x: 5.254993799999994, y: 5.2149888 },
              { x: 5.254993799999994, y: -5.214988799999972 },
              { x: -5.254993799999994, y: -5.214988799999972 },
              { x: -5.254993799999994, y: 5.2149888 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C407949.obj?uuid=f40519fab00548e1a81f96812540c2eb",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C407949.step?uuid=f40519fab00548e1a81f96812540c2eb",
        pcbRotationOffset: 0,
        modelOriginPosition: {
          x: 0.004999999999999893,
          y: 0.00041899999998573634,
          z: -12.510007000000002,
        },
      }}
      {...restProps}
    />
  )
}
