/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { ConnectorProps } from "@tscircuit/props-for-sepic-repro"

const pinLabels = {
  pin1: ["pin1"],
  pin2: ["pin2"],
} as const

const pinAttributes = {
  pin1: { isPassive: true },
  pin2: { isPassive: true },
} satisfies NonNullable<ConnectorProps["pinAttributes"]>

export const KF301_5_0_2P = (props: ConnectorProps): ReactElement => {
  return (
    <connector
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
        jlcpcb: ["C474881"],
      }}
      manufacturerPartNumber="KF301-5.0-2P"
      footprint={
        <footprint insertionDirection="from_bottom">
          <platedhole
            portHints={["pin1"]}
            pcbX="-2.499995mm"
            pcbY="0mm"
            outerDiameter="2.1999956mm"
            holeDiameter="1.3999972mm"
            shape="circle"
          />
          <platedhole
            portHints={["pin2"]}
            pcbX="2.499995mm"
            pcbY="0mm"
            outerDiameter="2.1999956mm"
            holeDiameter="1.3999972mm"
            shape="circle"
          />
          <silkscreenpath
            route={[
              { x: -3.468878000000018, y: -3.700805399999922 },
              { x: -3.468878000000018, y: -1.5011908000000176 },
              { x: -1.5486888000000363, y: -1.5011908000000176 },
              { x: -1.5486888000000363, y: -3.700805399999922 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 1.530248400000005, y: -3.700018 },
              { x: 1.530248400000005, y: -1.5000223999999207 },
              { x: 3.4500057999999854, y: -1.5000223999999207 },
              { x: 3.4500057999999854, y: -3.700018 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -5.000015400000052, y: 3.99999200000002 },
              { x: 4.999989999999912, y: 3.99999200000002 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 4.999989999999912, y: 3.99999200000002 },
              { x: 4.999989999999912, y: -3.6999925999998595 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -5.000015400000052, y: 3.99999200000002 },
              { x: -5.000015400000052, y: -3.6999925999998595 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -5.000015400000052, y: -3.6999925999998595 },
              { x: 4.999989999999912, y: -3.6999925999998595 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -5.000015400000052, y: 2.2005543999998736 },
              { x: 4.999989999999912, y: 2.2005543999998736 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 5.079999999999927, y: 2.6669999999999163 },
              { x: 5.707989600000019, y: 2.6669999999999163 },
              { x: 5.707989600000019, y: 1.6263873999999987 },
              { x: 5.079999999999927, y: 1.6263873999999987 },
            ]}
          />
          <silkscreentext
            text="{NAME}"
            pcbX="0.290195mm"
            pcbY="4.9878mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <fabricationnotepath
            route={[
              { x: -3.596004999999991, y: -3.700780000000009 },
              { x: -3.596004999999991, y: -1.501139999999964 },
              { x: -3.5588075612106422, y: -1.4113374387892463 },
              { x: -3.4690050000000383, y: -1.3741399999998976 },
              { x: -1.5487650000001167, y: -1.3741399999998976 },
              { x: -1.4589624387893991, y: -1.4113374387892463 },
              { x: -1.4217650000000503, y: -1.501139999999964 },
              { x: -1.4217650000000503, y: -3.700780000000009 },
              { x: -1.5487650000001167, y: -3.8277799999999615 },
              { x: -1.6757650000000694, y: -3.700780000000009 },
              { x: -1.6757650000000694, y: -1.6281399999999167 },
              { x: -3.342004999999972, y: -1.6281399999999167 },
              { x: -3.342004999999972, y: -3.700780000000009 },
              { x: -3.4690050000000383, y: -3.8277799999999615 },
              { x: -3.596004999999991, y: -3.700780000000009 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <fabricationnotepath
            route={[
              { x: 1.4041373999999678, y: -3.700780000000009 },
              { x: 1.4041373999999678, y: -1.501190799999904 },
              { x: 1.4413348387893166, y: -1.4113882387891863 },
              { x: 1.5311373999999205, y: -1.3741907999999512 },
              { x: 3.4513774000000694, y: -1.3741907999999512 },
              { x: 3.541179961210787, y: -1.4113882387891863 },
              { x: 3.578377400000136, y: -1.501190799999904 },
              { x: 3.578377400000136, y: -3.700780000000009 },
              { x: 3.4513774000000694, y: -3.8277799999999615 },
              { x: 3.3243774000001167, y: -3.700780000000009 },
              { x: 3.3243774000001167, y: -1.6281907999999703 },
              { x: 1.6581373999999869, y: -1.6281907999999703 },
              { x: 1.6581373999999869, y: -3.700780000000009 },
              { x: 1.5311373999999205, y: -3.8277799999999615 },
              { x: 1.4041373999999678, y: -3.700780000000009 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <courtyardoutline
            outline={[
              { x: -5.249990000000139, y: 4.24999200000002 },
              { x: 5.849988799999892, y: 4.24999200000002 },
              { x: 5.849988799999892, y: -3.8499927999999954 },
              { x: -5.249990000000139, y: -3.8499927999999954 },
              { x: -5.249990000000139, y: 4.24999200000002 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C474881.obj?uuid=ccfba28652874fb7a69eea8ba34eb61b",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C474881.step?uuid=ccfba28652874fb7a69eea8ba34eb61b",
        pcbRotationOffset: 0,
        modelOriginPosition: {
          x: 0,
          y: -0.1499495999999556,
          z: -4.950006999999999,
        },
      }}
      {...props}
    />
  )
}
