import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["GND1"],
  pin2: ["GND2"],
  pin3: ["GND3"],
  pin4: ["GND4"],
  pin5: ["GND5"],
  pin6: ["RXEN"],
  pin7: ["TXEN"],
  pin8: ["DIO2"],
  pin9: ["VCC"],
  pin10: ["GND6"],
  pin11: ["GND7"],
  pin12: ["GND8"],
  pin13: ["DIO1"],
  pin14: ["BUSY"],
  pin15: ["NRST"],
  pin16: ["MISO"],
  pin17: ["MOSI"],
  pin18: ["SCK"],
  pin19: ["NSS"],
  pin20: ["GND9"],
  pin21: ["ANT"],
  pin22: ["GND10"],
} as const

const pinAttributes = {
  pin1: { requiresGround: true },
  pin2: { requiresGround: true },
  pin3: { requiresGround: true },
  pin4: { requiresGround: true },
  pin5: { requiresGround: true },
  pin9: { requiresPower: true },
  pin10: { requiresGround: true },
  pin11: { requiresGround: true },
  pin12: { requiresGround: true },
  pin20: { requiresGround: true },
  pin22: { requiresGround: true },
} as const

export const E22_900M22S = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
        jlcpcb: ["C411293"],
      }}
      manufacturerPartNumber="E22-900M22S"
      footprint={
        <footprint>
          <smtpad
            portHints={["pin1"]}
            pcbX="6.999986mm"
            pcbY="-8.499983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin2"]}
            pcbX="6.999986mm"
            pcbY="-7.229983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin3"]}
            pcbX="6.999986mm"
            pcbY="-5.959983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin4"]}
            pcbX="6.999986mm"
            pcbY="-0.390017mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin5"]}
            pcbX="6.999986mm"
            pcbY="0.879983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin6"]}
            pcbX="6.999986mm"
            pcbY="2.149983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin7"]}
            pcbX="6.999986mm"
            pcbY="3.419983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin8"]}
            pcbX="6.999986mm"
            pcbY="4.689983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin9"]}
            pcbX="6.999986mm"
            pcbY="5.959983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin10"]}
            pcbX="6.999986mm"
            pcbY="7.229983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin11"]}
            pcbX="6.999986mm"
            pcbY="8.499983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin12"]}
            pcbX="-6.999986mm"
            pcbY="8.499983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin13"]}
            pcbX="-6.999986mm"
            pcbY="7.229983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin14"]}
            pcbX="-6.999986mm"
            pcbY="5.959983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin15"]}
            pcbX="-6.999986mm"
            pcbY="4.689983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin16"]}
            pcbX="-6.999986mm"
            pcbY="3.419983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin17"]}
            pcbX="-6.999986mm"
            pcbY="2.149983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin18"]}
            pcbX="-6.999986mm"
            pcbY="0.879983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin19"]}
            pcbX="-6.999986mm"
            pcbY="-0.390017mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin20"]}
            pcbX="-6.999986mm"
            pcbY="-5.959983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin21"]}
            pcbX="-6.999986mm"
            pcbY="-7.229983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin22"]}
            pcbX="-6.999986mm"
            pcbY="-8.499983mm"
            width="1.7999964mm"
            height="0.8999982mm"
            shape="rect"
          />
          <silkscreenpath
            route={[
              { x: -7.000011400000062, y: 10.49997899999994 },
              { x: 7.0000113999999485, y: 10.49997899999994 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -7.000011400000062, y: -9.500006399999961 },
              { x: 6.9849999999999, y: -9.500006399999961 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 7.0000113999999485, y: 10.49997899999994 },
              { x: 7.0000113999999485, y: 9.181134800000109 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 7.0000113999999485, y: -1.0711687999998958 },
              { x: 7.0000113999999485, y: -5.278856599999926 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 7.0000113999999485, y: -9.181160199999795 },
              { x: 7.0000113999999485, y: -9.500006399999961 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -7.000011400000062, y: 10.49997899999994 },
              { x: -7.000011400000062, y: 9.181134800000109 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -7.000011400000062, y: -1.0711687999998958 },
              { x: -7.000011400000062, y: -5.278856599999926 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -7.000011400000062, y: -9.181160199999795 },
              { x: -7.000011400000062, y: -9.500006399999961 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -5.080000000000041, y: 9.134983000000034 },
              { x: 5.079999999999927, y: 9.134983000000034 },
              { x: 5.079999999999927, y: -7.375016999999957 },
              { x: -1.2699999999999818, y: -7.375016999999957 },
              { x: -1.2699999999999818, y: -3.565016999999898 },
              { x: -5.080000000000041, y: -3.565016999999898 },
              { x: -5.080000000000041, y: 9.134983000000034 },
            ]}
          />
          <silkscreencircle
            pcbX="7.458456mm"
            pcbY="-9.427337mm"
            radius="0.081534mm"
          />
          <silkscreentext
            text="{NAME}"
            pcbX="0mm"
            pcbY="11.506583mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <courtyardoutline
            outline={[
              { x: -8.149984200000176, y: 10.74997899999994 },
              { x: 8.149984200000063, y: 10.74997899999994 },
              { x: 8.149984200000063, y: -9.74998099999982 },
              { x: -8.149984200000176, y: -9.74998099999982 },
              { x: -8.149984200000176, y: 10.74997899999994 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C411293.obj?uuid=9a81a71dd1e74d01a59312d2a1c04793",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C411293.step?uuid=9a81a71dd1e74d01a59312d2a1c04793",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: -0.4999990000001162, z: 0 },
      }}
      {...props}
    />
  )
}
