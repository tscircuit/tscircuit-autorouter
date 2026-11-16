/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { DiodeProps } from "@tscircuit/props-for-sepic-repro"

const pinLabels = {
  pin1: ["cathode", "neg"],
  pin2: ["anode", "pos"],
} as const

export const SS510C = (props: DiodeProps): ReactElement => {
  const { name = "D1", ...restProps } = props

  return (
    <diode
      name={name}
      pinLabels={pinLabels}
      supplierPartNumbers={{
        jlcpcb: ["C123944"],
      }}
      manufacturerPartNumber="SS510C"
      footprint={
        <footprint>
          <smtpad
            portHints={["pin2", "anode", "pos"]}
            pcbX="3.434969mm"
            pcbY="0mm"
            width="3.0299914mm"
            height="3.8200076mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin1", "cathode", "neg"]}
            pcbX="-3.434969mm"
            pcbY="0mm"
            width="3.0299914mm"
            height="3.8200076mm"
            shape="rect"
          />
          <silkscreenpath
            route={[
              { x: -1.1918187999998509, y: 3.1100013999999874 },
              { x: -1.1918187999998509, y: -3.1100013999999874 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -3.6000182000000223, y: -2.1411438000001226 },
              { x: -3.6000182000000223, y: -3.1100013999999874 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -3.6000182000000223, y: 3.1100013999999874 },
              { x: -3.6000182000000223, y: 2.141143800000009 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 3.5999674000000823, y: -2.1411438000001226 },
              { x: 3.5999674000000823, y: -3.1100013999999874 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 3.5999674000000823, y: 3.1100013999999874 },
              { x: 3.5999674000000823, y: 2.141143800000009 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -3.6000182000000223, y: -3.1100013999999874 },
              { x: 3.5999674000000823, y: -3.1100013999999874 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -3.6000182000000223, y: 3.1100013999999874 },
              { x: 3.5999674000000823, y: 3.1100013999999874 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -0.000025400000026820635, y: 0 },
              { x: 1.0159746000000496, y: -0.5080000000000382 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 1.0159746000000496, y: -0.5080000000000382 },
              { x: 1.0159746000000496, y: 0.5079999999999245 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 1.0159746000000496, y: 0.5079999999999245 },
              { x: -0.000025400000026820635, y: 0 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -0.000025400000026820635, y: 0 },
              { x: -0.000025400000026820635, y: -0.5080000000000382 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -0.000025400000026820635, y: -0.5080000000000382 },
              { x: -0.000025400000026820635, y: 0.5079999999999245 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 1.523974599999974, y: 0 },
              { x: -0.5080253999999513, y: 0 },
            ]}
          />
          <silkscreentext
            text="{NAME}"
            pcbX="0.003429mm"
            pcbY="4.0988mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <fabricationnotepath
            route={[
              { x: -4.330192000000125, y: 0.2540000000000191 },
              { x: -2.5521920000001046, y: 0.2540000000000191 },
              { x: -2.5521920000001046, y: -0.2540000000000191 },
              { x: -4.330192000000125, y: -0.2540000000000191 },
              { x: -4.330192000000125, y: 0.2540000000000191 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <fabricationnotepath
            route={[
              { x: 3.1810959999999113, y: -0.8950959999999668 },
              { x: 3.1810959999999113, y: 0.8829040000000532 },
              { x: 3.6890959999999495, y: 0.8829040000000532 },
              { x: 3.6890959999999495, y: -0.8950959999999668 },
              { x: 3.1810959999999113, y: -0.8950959999999668 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <fabricationnotepath
            route={[
              { x: 2.5399999999999636, y: 0.2540000000000191 },
              { x: 4.317999999999984, y: 0.2540000000000191 },
              { x: 4.317999999999984, y: -0.2540000000000191 },
              { x: 2.5399999999999636, y: -0.2540000000000191 },
              { x: 2.5399999999999636, y: 0.2540000000000191 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <courtyardoutline
            outline={[
              { x: -5.1999647000000095, y: 3.249994000000129 },
              { x: 5.1999647000000095, y: 3.249994000000129 },
              { x: 5.1999647000000095, y: -3.249994000000015 },
              { x: -5.1999647000000095, y: -3.249994000000015 },
              { x: -5.1999647000000095, y: 3.249994000000129 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C123944.obj?uuid=3b43493af98043e0bdb7e11a716efe19",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C123944.step?uuid=3b43493af98043e0bdb7e11a716efe19",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: 0, z: -0.1 },
      }}
      {...restProps}
    />
  )
}
