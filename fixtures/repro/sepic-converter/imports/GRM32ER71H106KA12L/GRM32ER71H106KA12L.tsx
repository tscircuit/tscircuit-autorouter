/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { CapacitorProps } from "@tscircuit/props-for-sepic-repro"

export const GRM32ER71H106KA12L = (props: Omit<CapacitorProps, "capacitance">): ReactElement => {
  const { name = "C1", ...restProps } = props

  return (
    <capacitor
      name={name}
      capacitance="10uF"
      supplierPartNumbers={{
        jlcpcb: ["C77102"],
      }}
      manufacturerPartNumber="GRM32ER71H106KA12L"
      footprint={
        <footprint>
          <smtpad
            portHints={["pin2"]}
            pcbX="1.517396mm"
            pcbY="0mm"
            width="1.634998mm"
            height="2.6999946mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin1"]}
            pcbX="-1.517396mm"
            pcbY="0mm"
            width="1.634998mm"
            height="2.6999946mm"
            shape="rect"
          />
          <silkscreenpath
            route={[
              { x: 2.5635965999999826, y: -1.4262099999999691 },
              { x: 2.5635965999999826, y: 1.4262100000000828 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 2.4111966000000393, y: 1.578610000000026 },
              { x: 0.7761985999999297, y: 1.578610000000026 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 0.7761985999999297, y: -1.578610000000026 },
              { x: 2.4111966000000393, y: -1.578610000000026 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.411196600000153, y: 1.578610000000026 },
              { x: -0.7761986000000434, y: 1.578610000000026 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -0.7761986000000434, y: -1.578610000000026 },
              { x: -2.411196600000153, y: -1.578610000000026 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.5635966000000963, y: -1.4262099999999691 },
              { x: -2.5635966000000963, y: 1.4262100000000828 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 2.4111966000000393, y: -1.578610000000026 },
              { x: 2.518959673452855, y: -1.5339730734527848 },
              { x: 2.5635965999999826, y: -1.4262099999999691 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 2.5635965999999826, y: 1.4262100000000828 },
              { x: 2.518959673452855, y: 1.5339730734528985 },
              { x: 2.4111966000000393, y: 1.578610000000026 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.411196600000153, y: -1.578610000000026 },
              { x: -2.5189596734529687, y: -1.5339730734527848 },
              { x: -2.5635966000000963, y: -1.4262099999999691 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.5635966000000963, y: 1.4262100000000828 },
              { x: -2.5189596734529687, y: 1.5339730734528985 },
              { x: -2.411196600000153, y: 1.578610000000026 },
            ]}
          />
          <silkscreentext
            text="{NAME}"
            pcbX="0mm"
            pcbY="2.5748mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <courtyardoutline
            outline={[
              { x: -2.584895000000188, y: 1.599997300000041 },
              { x: 2.584895000000074, y: 1.599997300000041 },
              { x: 2.584895000000074, y: -1.599997300000041 },
              { x: -2.584895000000188, y: -1.599997300000041 },
              { x: -2.584895000000188, y: 1.599997300000041 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C77102.obj?uuid=0f62590f50b54fa48364a4157b2b6286",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C77102.step?uuid=0f62590f50b54fa48364a4157b2b6286",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: -0.000012700000070253736, z: -1.25 },
      }}
      {...restProps}
    />
  )
}
