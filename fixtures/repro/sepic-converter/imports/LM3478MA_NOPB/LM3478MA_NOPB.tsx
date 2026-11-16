/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { ChipProps } from "@tscircuit/props-for-sepic-repro"

const pinLabels = {
  pin1: ["ISEN"],
  pin2: ["COMP"],
  pin3: ["FB"],
  pin4: ["AGND"],
  pin5: ["PGND"],
  pin6: ["DR"],
  pin7: ["FA", "SD"],
  pin8: ["VIN"],
} as const

const pinAttributes = {
  pin1: { isInput: true },
  pin2: { isOutput: true },
  pin3: { isInput: true },
  pin6: { isOutput: true },
  pin7: { isInput: true },
  pin4: { requiresGround: true },
  pin5: { requiresGround: true },
  pin8: { requiresPower: true },
} as const

export const LM3478MA_NOPB = (
  props: ChipProps<typeof pinLabels>,
): ReactElement => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
        jlcpcb: ["C1530061"],
      }}
      manufacturerPartNumber="LM3478MA/NOPB"
      footprint={
        <footprint>
          <smtpad
            portHints={["pin5"]}
            pcbX="1.905mm"
            pcbY="2.599944mm"
            width="0.58801mm"
            height="1.7999964mm"
            radius="0.294005mm"
            shape="pill"
          />
          <smtpad
            portHints={["pin6"]}
            pcbX="0.635mm"
            pcbY="2.599944mm"
            width="0.58801mm"
            height="1.7999964mm"
            radius="0.294005mm"
            shape="pill"
          />
          <smtpad
            portHints={["pin7"]}
            pcbX="-0.635mm"
            pcbY="2.599944mm"
            width="0.58801mm"
            height="1.7999964mm"
            radius="0.294005mm"
            shape="pill"
          />
          <smtpad
            portHints={["pin8"]}
            pcbX="-1.905mm"
            pcbY="2.599944mm"
            width="0.58801mm"
            height="1.7999964mm"
            radius="0.294005mm"
            shape="pill"
          />
          <smtpad
            portHints={["pin4"]}
            pcbX="1.905mm"
            pcbY="-2.599944mm"
            width="0.58801mm"
            height="1.7999964mm"
            radius="0.294005mm"
            shape="pill"
          />
          <smtpad
            portHints={["pin3"]}
            pcbX="0.635mm"
            pcbY="-2.599944mm"
            width="0.58801mm"
            height="1.7999964mm"
            radius="0.294005mm"
            shape="pill"
          />
          <smtpad
            portHints={["pin2"]}
            pcbX="-0.635mm"
            pcbY="-2.599944mm"
            width="0.58801mm"
            height="1.7999964mm"
            radius="0.294005mm"
            shape="pill"
          />
          <smtpad
            portHints={["pin1"]}
            pcbX="-1.905mm"
            pcbY="-2.599944mm"
            width="0.58801mm"
            height="1.7999964mm"
            radius="0.294005mm"
            shape="pill"
          />
          <silkscreenpath
            route={[
              { x: -2.5262078000000656, y: -1.5214091999999937 },
              { x: 2.526207799999952, y: -1.5214091999999937 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.5262078000000656, y: 1.5214092000001074 },
              { x: 2.526207799999952, y: 1.5214092000001074 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.5262078000000656, y: -0.43538139999998293 },
              { x: -2.5262078000000656, y: -1.5214091999999937 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.5262078000000656, y: 0.44889420000004066 },
              { x: -2.5262078000000656, y: 1.5214092000001074 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.0675600000000713, y: -1.5214091999999937 },
              { x: -2.5262078000000656, y: -1.5214091999999937 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -0.7975599999999758, y: -1.5214091999999937 },
              { x: -1.7424400000001015, y: -1.5214091999999937 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 0.47244000000000597, y: -1.5214091999999937 },
              { x: -0.47244000000011965, y: -1.5214091999999937 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 1.7424399999999878, y: -1.5214091999999937 },
              { x: 0.7975599999999758, y: -1.5214091999999937 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 2.526207799999952, y: -1.5214091999999937 },
              { x: 2.0675599999999577, y: -1.5214091999999937 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 2.526207799999952, y: 1.5214092000001074 },
              { x: 2.526207799999952, y: -1.5214091999999937 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.0675600000000713, y: 1.5214092000001074 },
              { x: -2.5262078000000656, y: 1.5214092000001074 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -0.7975599999999758, y: 1.5214092000001074 },
              { x: -1.7424400000001015, y: 1.5214092000001074 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 0.47244000000000597, y: 1.5214092000001074 },
              { x: -0.47244000000011965, y: 1.5214092000001074 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 1.7424399999999878, y: 1.5214092000001074 },
              { x: 0.7975599999999758, y: 1.5214092000001074 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 2.526207799999952, y: 1.5214092000001074 },
              { x: 2.0675599999999577, y: 1.5214092000001074 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.5262078000000656, y: -0.43538139999986925 },
              { x: -2.3051388999999745, y: -0.37614616677331014 },
              { x: -2.1433052332267835, y: -0.21431250000000546 },
              { x: -2.0840700000001107, y: 0.006756400000085705 },
              { x: -2.1433052332267835, y: 0.22782530000017687 },
              { x: -2.3051388999999745, y: 0.38965896677336787 },
              { x: -2.5262078000000656, y: 0.44889420000004066 },
            ]}
          />
          <silkscreencircle
            pcbX="-1.905mm"
            pcbY="-1.016mm"
            radius="0.150114mm"
          />
          <silkscreentext
            text="{NAME}"
            pcbX="0.0127mm"
            pcbY="4.2004mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <courtyardoutline
            outline={[
              { x: -2.699982400000067, y: 3.7499422000000777 },
              { x: 2.7000077999998666, y: 3.7499422000000777 },
              { x: 2.7000077999998666, y: -3.749942199999964 },
              { x: -2.699982400000067, y: -3.749942199999964 },
              { x: -2.699982400000067, y: 3.7499422000000777 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C1530061.obj?uuid=ec3b9f9b31a74655be3e55848dbee9c1",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C1530061.step?uuid=ec3b9f9b31a74655be3e55848dbee9c1",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: -0.000012700000070253736, y: 0, z: 0 },
      }}
      {...props}
    />
  )
}
