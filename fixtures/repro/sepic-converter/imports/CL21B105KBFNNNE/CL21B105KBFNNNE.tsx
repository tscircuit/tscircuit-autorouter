/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { CapacitorProps } from "@tscircuit/props-for-sepic-repro"

export const CL21B105KBFNNNE = (props: Omit<CapacitorProps, "capacitance">): ReactElement => {
  const { name = "C1", ...restProps } = props

  return (
    <capacitor
      name={name}
      capacitance="1uF"
      supplierPartNumbers={{
        jlcpcb: ["C28323"],
      }}
      manufacturerPartNumber="CL21B105KBFNNNE"
      footprint={
        <footprint>
          <smtpad
            portHints={["pin2"]}
            pcbX="0.999998mm"
            pcbY="0mm"
            width="1.4100048mm"
            height="1.35001mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin1"]}
            pcbX="-0.999998mm"
            pcbY="0mm"
            width="1.4100048mm"
            height="1.35001mm"
            shape="rect"
          />
          <silkscreenpath
            route={[
              { x: 1.8111977999999453, y: 0.9036049999999705 },
              { x: 0.4011929999999211, y: 0.9036049999999705 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 0.4011929999999211, y: -0.9036049999999705 },
              { x: 1.8111977999999453, y: -0.9036049999999705 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 1.9635978000000023, y: -0.7512050000000272 },
              { x: 1.9635978000000023, y: 0.7512050000000272 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -1.811197800000059, y: 0.9036049999999705 },
              { x: -0.40119300000003477, y: 0.9036049999999705 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -0.40119300000003477, y: -0.9036049999999705 },
              { x: -1.811197800000059, y: -0.9036049999999705 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -1.9635978000000023, y: -0.7512050000000272 },
              { x: -1.9635978000000023, y: 0.7512050000000272 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 1.8111977999999453, y: -0.9036049999997431 },
              { x: 1.918960873452761, y: -0.8589680734526155 },
              { x: 1.9635977999998886, y: -0.7512050000000272 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 1.9635977999998886, y: 0.7512050000000272 },
              { x: 1.918960873452761, y: 0.8589680734527292 },
              { x: 1.8111977999999453, y: 0.9036049999998568 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -1.811197800000059, y: -0.9036049999997431 },
              { x: -1.9189608734528747, y: -0.8589680734526155 },
              { x: -1.9635978000000023, y: -0.7512050000000272 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -1.9635978000000023, y: 0.7512050000000272 },
              { x: -1.9189608734528747, y: 0.8589680734527292 },
              { x: -1.811197800000059, y: 0.9036049999998568 },
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
              { x: -1.9550003999999035, y: 0.9250050000000556 },
              { x: 1.9550003999999035, y: 0.9250050000000556 },
              { x: 1.9550003999999035, y: -0.9250050000000556 },
              { x: -1.9550003999999035, y: -0.9250050000000556 },
              { x: -1.9550003999999035, y: 0.9250050000000556 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C28323.obj?uuid=b87ab0c5465a48b3a1c9a6dac8d30bc5",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C28323.step?uuid=b87ab0c5465a48b3a1c9a6dac8d30bc5",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: -0.000012700000070253736, z: -0.65 },
      }}
      {...restProps}
    />
  )
}
