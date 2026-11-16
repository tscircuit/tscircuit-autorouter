/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { CapacitorProps } from "@tscircuit/props-for-sepic-repro"

export const EEUFR1E101 = (props: Omit<CapacitorProps, "capacitance">): ReactElement => {
  const { name = "C1", ...restProps } = props

  return (
    <capacitor
      name={name}
      capacitance="100uF"
      polarized
      supplierPartNumbers={{
        jlcpcb: ["C264049"],
      }}
      manufacturerPartNumber="EEUFR1E101"
      footprint={
        <footprint>
          <platedhole
            portHints={["pin1"]}
            pcbX="-1.27mm"
            pcbY="0mm"
            outerDiameter="1.5999968mm"
            holeDiameter="0.999998mm"
            shape="circle"
          />
          <platedhole
            portHints={["pin2"]}
            pcbX="1.27mm"
            pcbY="0mm"
            outerDiameter="1.5999968mm"
            holeDiameter="0.999998mm"
            shape="circle"
          />
          <silkscreenpath
            route={[
              { x: -1.269999999999996, y: 2.0320000000000107 },
              { x: -1.269999999999996, y: 1.0160000000000053 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -1.7780000000000058, y: 1.524000000000001 },
              { x: -0.7620000000000005, y: 1.524000000000001 },
            ]}
          />
          <silkscreencircle pcbX="0mm" pcbY="0mm" radius="3.1496mm" />
          <silkscreentext
            text="{NAME}"
            pcbX="0mm"
            pcbY="4.1496mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <fabricationnotepath
            route={[
              { x: -1.99999600000001, y: 1.6999966000000057 },
              { x: -0.4999990000000025, y: 1.6999966000000057 },
              { x: -0.4999990000000025, y: 1.3999972000000014 },
              { x: -1.99999600000001, y: 1.3999972000000014 },
              { x: -1.99999600000001, y: 1.6999966000000057 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <fabricationnotepath
            route={[
              { x: -1.380997999999991, y: 0.7518907999999982 },
              { x: -1.380997999999991, y: 2.2518878000000058 },
              { x: -1.080998600000001, y: 2.2518878000000058 },
              { x: -1.080998600000001, y: 0.7518907999999982 },
              { x: -1.380997999999991, y: 0.7518907999999982 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <courtyardrect pcbX={0} pcbY={0} width={7} height={7} />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C264049.obj?uuid=b565ea104e684643a82bac9b1c8da51e",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C264049.step?uuid=b565ea104e684643a82bac9b1c8da51e",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0.0050000000000001155, y: 0, z: -11.100007 },
      }}
      {...restProps}
    />
  )
}
