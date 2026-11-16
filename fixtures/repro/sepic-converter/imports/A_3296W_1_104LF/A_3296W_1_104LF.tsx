/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { PotentiometerProps } from "@tscircuit/props-for-sepic-repro"

export const A_3296W_1_104LF = (
  props: Omit<PotentiometerProps, "maxResistance">,
): ReactElement => {
  return (
    <potentiometer
      maxResistance="100k"
      pinVariant="three_pin"
      pinAttributes={{
        pin1: { isPassive: true },
        pin2: { isPassive: true },
        pin3: { isPassive: true },
      }}
      symbol={
        <symbol>
          <port
            name="pin1"
            pinNumber={1}
            aliases={["1"]}
            direction="up"
            schX={0.1}
            schY={0.4}
            schStemLength={0.2}
          />
          <schematicpath
            points={[
              { x: 0.02, y: -0.2 },
              { x: 0.02, y: 0.2 },
              { x: 0.22, y: 0.2 },
              { x: 0.22, y: -0.2 },
              { x: 0.02, y: -0.2 },
            ]}
            strokeColor="#880000"
          />
          <port
            name="pin2"
            pinNumber={2}
            aliases={["2"]}
            direction="left"
            schX={-0.2}
            schY={0}
            schStemLength={0.2}
          />
          <port
            name="pin3"
            pinNumber={3}
            aliases={["3"]}
            direction="down"
            schX={0.1}
            schY={-0.4}
            schStemLength={0.2}
          />
          <schematicpath
            points={[
              { x: -0.02, y: 0 },
              { x: -0.12, y: 0 },
            ]}
            strokeColor="#880000"
          />
          <schematicpath
            points={[
              { x: 0.02, y: 0 },
              { x: -0.08, y: -0.04 },
              { x: -0.08, y: 0.04 },
              { x: 0.02, y: 0 },
            ]}
            strokeColor="#880000"
            isFilled
            fillColor="#EFEFEF"
          />
          <schematictext
            schX={0}
            schY={0.62}
            text="{NAME}"
            fontSize={0.2}
            anchor="bottom_center"
          />
        </symbol>
      }
      supplierPartNumbers={{
        jlcpcb: ["C48084"],
      }}
      manufacturerPartNumber="3296W-1-104LF"
      footprint={
        <footprint>
          <platedhole
            portHints={["pin2"]}
            pcbX="0.0670052mm"
            pcbY="0mm"
            outerDiameter="1.524mm"
            holeDiameter="0.762mm"
            shape="circle"
          />
          <platedhole
            portHints={["pin1"]}
            pcbX="0.0670052mm"
            pcbY="2.54mm"
            outerDiameter="1.524mm"
            holeDiameter="0.762mm"
            shape="circle"
          />
          <platedhole
            portHints={["pin3"]}
            pcbX="0.0670052mm"
            pcbY="-2.54mm"
            outerDiameter="1.524mm"
            holeDiameter="0.762mm"
            shape="circle"
          />
          <silkscreenpath
            route={[
              { x: 1.3970000000000482, y: 2.804159999999996 },
              { x: 1.77800000000002, y: 2.804159999999996 },
              { x: 2.158999999999992, y: 2.804159999999996 },
              { x: 1.77800000000002, y: 2.804159999999996 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 2.3176738000000796, y: 2.804159999999996 },
              { x: 2.26231540943985, y: 3.037294428762806 },
              { x: 2.1115361290063674, y: 3.2235249898207314 },
              { x: 1.8950240487906171, y: 3.3261833182730243 },
              { x: 1.6554098944782822, y: 3.3250562276996902 },
              { x: 1.4398731364836976, y: 3.220365639616631 },
              { x: 1.290852461812733, y: 3.03272488764469 },
              { x: 1.23768969516658, y: 2.7990800000000036 },
              { x: 1.290852461812733, y: 2.5654351123552885 },
              { x: 1.4398731364836976, y: 2.377794360383348 },
              { x: 1.6554098944782822, y: 2.2731037723002885 },
              { x: 1.8950240487906171, y: 2.271976681726926 },
              { x: 2.1115361290063674, y: 2.3746350101792473 },
              { x: 2.26231540943985, y: 2.560865571237173 },
              { x: 2.3176738000000796, y: 2.7939999999999827 },
            ]}
          />
          <silkscreenrect
            pcbX="0mm"
            pcbY="0mm"
            width="5.334mm"
            height="9.652mm"
            strokeWidth="0.254mm"
          />
          <silkscreenrect
            pcbX="-2.413127mm"
            pcbY="4.369054mm"
            width="0.199898mm"
            height="0.762mm"
            strokeWidth="0.254mm"
          />
          <silkscreenrect
            pcbX="-2.413127mm"
            pcbY="-4.3688mm"
            width="0.199898mm"
            height="0.762mm"
            strokeWidth="0.254mm"
          />
          <silkscreentext
            text="{NAME}"
            pcbX="0mm"
            pcbY="5.83616mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <fabricationnotepath
            route={[
              { x: 2.283663200000035, y: 2.9882083999999907 },
              { x: 2.1684336220736213, y: 3.1717610406531946 },
              { x: 1.9903159370289245, y: 3.2952256825317363 },
              { x: 1.77800000000002, y: 3.338715571050926 },
              { x: 1.5656840629711724, y: 3.2952256825317363 },
              { x: 1.3875663779264755, y: 3.1717610406531946 },
              { x: 1.2723368000000619, y: 2.9882083999999907 },
              { x: 2.283663200000035, y: 2.9882083999999907 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <fabricationnotepath
            route={[
              { x: 1.272311400000035, y: 2.620111599999973 },
              { x: 1.3875409779264487, y: 2.436558959346769 },
              { x: 1.5656586629711455, y: 2.3130943174682557 },
              { x: 1.7779745999999932, y: 2.2696044289490374 },
              { x: 1.9902905370288977, y: 2.3130943174682557 },
              { x: 2.1684082220735945, y: 2.436558959346769 },
              { x: 2.283637800000065, y: 2.620111599999973 },
              { x: 1.272311400000035, y: 2.620111599999973 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <courtyardoutline
            outline={[
              { x: -2.5229951999999685, y: 5.0001301999999725 },
              { x: 2.7769951999999876, y: 5.0001301999999725 },
              { x: 2.7769951999999876, y: -4.999850800000019 },
              { x: -2.5229951999999685, y: -4.999850800000019 },
              { x: -2.5229951999999685, y: 5.0001301999999725 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C48084.obj?uuid=a5868fa2538948c18b4c4c1e84b6a92a",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C48084.step?uuid=a5868fa2538948c18b4c4c1e84b6a92a",
        pcbRotationOffset: 90,
        modelOriginPosition: {
          x: -0.00013969999997698324,
          y: 0.12700000000000955,
          z: -0.000006999999999646178,
        },
      }}
      {...props}
    />
  )
}
