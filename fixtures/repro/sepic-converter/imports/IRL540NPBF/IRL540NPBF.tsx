/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { MosfetProps } from "@tscircuit/props-for-sepic-repro"

export const IRL540NPBF = (
  props: Omit<MosfetProps, "channelType" | "mosfetMode">,
): ReactElement => {
  return (
    <mosfet
      channelType="n"
      mosfetMode="enhancement"
      pinAttributes={{
        pin1: { isInput: true },
        pin2: { isPassive: true },
        pin3: { isPassive: true },
      }}
      symbol={
        <symbol>
          <schematicpath
            points={[
              { x: 0, y: 0 },
              { x: 0.12, y: -0.04 },
              { x: 0.12, y: 0.04 },
              { x: 0, y: 0 },
            ]}
            strokeColor="#880000"
            isFilled
            fillColor="#880000"
          />
          <schematicpath
            points={[
              { x: 0.4, y: 0.06 },
              { x: 0.34, y: -0.04 },
              { x: 0.46, y: -0.04 },
              { x: 0.4, y: 0.06 },
            ]}
            strokeColor="#880000"
            isFilled
            fillColor="#880000"
          />
          <schematicpath
            points={[
              { x: 0.2, y: -0.2 },
              { x: 0.4, y: -0.2 },
              { x: 0.4, y: -0.04 },
            ]}
            strokeColor="#880000"
          />
          <schematicpath
            points={[
              { x: 0.2, y: 0.14 },
              { x: 0.2, y: 0.2 },
              { x: 0.4, y: 0.2 },
              { x: 0.4, y: 0.06 },
            ]}
            strokeColor="#880000"
          />
          <schematicpath
            points={[
              { x: 0.2, y: 0.14 },
              { x: 0, y: 0.14 },
            ]}
            strokeColor="#880000"
          />
          <schematicpath
            points={[
              { x: 0, y: 0 },
              { x: 0.2, y: 0 },
              { x: 0.2, y: -0.2 },
            ]}
            strokeColor="#880000"
          />
          <schematicpath
            points={[
              { x: 0.2, y: -0.14 },
              { x: 0, y: -0.14 },
            ]}
            strokeColor="#880000"
          />
          <schematicpath
            points={[
              { x: -0.04, y: 0.18 },
              { x: -0.04, y: -0.18 },
            ]}
            strokeColor="#880000"
          />
          <schematicpath
            points={[
              { x: 0, y: 0.1 },
              { x: 0, y: 0.18 },
            ]}
            strokeColor="#880000"
          />
          <schematicpath
            points={[
              { x: 0, y: -0.04 },
              { x: 0, y: 0.04 },
            ]}
            strokeColor="#880000"
          />
          <schematicpath
            points={[
              { x: 0, y: -0.18 },
              { x: 0, y: -0.1 },
            ]}
            strokeColor="#880000"
          />
          <schematicpath
            points={[
              { x: -0.2, y: 0 },
              { x: -0.04, y: 0 },
            ]}
            strokeColor="#880000"
          />
          <schematicpath
            points={[
              { x: 0.34, y: 0.06 },
              { x: 0.36, y: 0.06 },
              { x: 0.44, y: 0.06 },
              { x: 0.46, y: 0.06 },
            ]}
            strokeColor="#880000"
          />
          <port
            name="pin2"
            pinNumber={2}
            aliases={["D", "drain"]}
            direction="up"
            schX={0.2}
            schY={0.4}
            schStemLength={0.2}
          />
          <port
            name="pin1"
            pinNumber={1}
            aliases={["G", "gate"]}
            direction="left"
            schX={-0.4}
            schY={0}
            schStemLength={0.2}
          />
          <port
            name="pin3"
            pinNumber={3}
            aliases={["S", "source"]}
            direction="down"
            schX={0.2}
            schY={-0.4}
            schStemLength={0.2}
          />
          <schematictext
            schX={0.02}
            schY={0.62}
            text="{NAME}"
            fontSize={0.2}
            anchor="bottom_center"
          />
        </symbol>
      }
      supplierPartNumbers={{
        jlcpcb: ["C111607"],
      }}
      manufacturerPartNumber="IRL540NPBF"
      footprint={
        <footprint>
          <platedhole
            portHints={["pin1"]}
            pcbX="0mm"
            pcbY="1.94000125mm"
            holeWidth="1.3000228mm"
            holeHeight="1.3000228mm"
            outerWidth="1.999996mm"
            outerHeight="2.499995mm"
            rectPad={true}
            pcbRotation="270deg"
            shape="pill"
          />
          <platedhole
            portHints={["pin3"]}
            pcbX="0mm"
            pcbY="-3.13999875mm"
            holeWidth="1.3000228mm"
            holeHeight="1.3000228mm"
            outerWidth="1.999996mm"
            outerHeight="2.499995mm"
            pcbRotation="270deg"
            shape="pill"
          />
          <platedhole
            portHints={["pin2"]}
            pcbX="0mm"
            pcbY="-0.59999875mm"
            holeWidth="1.3000228mm"
            holeHeight="1.3000228mm"
            outerWidth="1.999996mm"
            outerHeight="2.499995mm"
            pcbRotation="270deg"
            shape="pill"
          />
          <silkscreenpath
            route={[
              { x: 1.8299937999997837, y: 4.480001249999987 },
              { x: 1.8299937999997837, y: -5.679998750000095 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -1.77800000000002, y: 4.480001249999987 },
              { x: -1.77800000000002, y: -5.679998750000095 },
              { x: 2.66700000000003, y: -5.679998750000095 },
              { x: 2.66700000000003, y: 4.480001249999987 },
              { x: -1.77800000000002, y: 4.480001249999987 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.463799999999992, y: 2.1686012500000516 },
              { x: -2.602717449194074, y: 2.3577762642159996 },
              { x: -2.8257478108985197, y: 2.2846824788965705 },
              { x: -2.8257478108985197, y: 2.049980021103238 },
              { x: -2.602717449194074, y: 1.9768862357838088 },
              { x: -2.463799999999992, y: 2.1660612499998706 },
            ]}
          />
          <silkscreentext
            text="{NAME}"
            pcbX="-0.0635mm"
            pcbY="5.48000125mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <fabricationnotepath
            route={[
              { x: 1.77800000000002, y: 4.480001249999987 },
              { x: 2.6669999999999163, y: 4.480001249999987 },
              { x: 2.6669999999999163, y: -5.679998750000095 },
              { x: 1.77800000000002, y: -5.679998750000095 },
              { x: 1.77800000000002, y: 4.480001249999987 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <courtyardoutline
            outline={[
              { x: -1.9999838000001091, y: 4.700003849999916 },
              { x: 3.0000071999999136, y: 4.700003849999916 },
              { x: 3.0000071999999136, y: -5.899975949999998 },
              { x: -1.9999838000001091, y: -5.899975949999998 },
              { x: -1.9999838000001091, y: 4.700003849999916 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C111607.obj?uuid=1934b78019cc4b7695a8f660c363bbf6",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C111607.step?uuid=1934b78019cc4b7695a8f660c363bbf6",
        pcbRotationOffset: 90,
        modelOriginPosition: {
          x: 0.5999860500000977,
          y: 0.050011699999959025,
          z: 2.800011799999999,
        },
      }}
      {...props}
    />
  )
}
