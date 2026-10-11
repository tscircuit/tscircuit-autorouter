import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["3V3"],
  pin2: ["EN"],
  pin3: ["IO4"],
  pin4: ["IO5"],
  pin5: ["IO6"],
  pin6: ["IO7"],
  pin7: ["IO8"],
  pin8: ["IO9"],
  pin9: ["GND"],
  pin10: ["IO10"],
  pin11: ["RXD"],
  pin12: ["TXD"],
  pin13: ["IO18"],
  pin14: ["IO19"],
  pin15: ["IO3"],
  pin16: ["IO2"],
  pin17: ["IO1"],
  pin18: ["IO0"],
  pin19: ["EP"],
} as const

const pinAttributes = {
  pin1: { requiresPower: true },
  pin9: { requiresGround: true },
  pin19: { requiresGround: true },
} as const

export const ESP32_C3_WROOM_02_N4 = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      supplierPartNumbers={{
        jlcpcb: ["C2934560"],
      }}
      manufacturerPartNumber="ESP32-C3-WROOM-02-N4"
      footprint={
        <footprint>
          <smtpad
            portHints={["pin1"]}
            pcbX="-8.750046mm"
            pcbY="5.999988mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin2"]}
            pcbX="-8.750046mm"
            pcbY="4.500118mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin3"]}
            pcbX="-8.750046mm"
            pcbY="2.999994mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin4"]}
            pcbX="-8.750046mm"
            pcbY="1.500124mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin5"]}
            pcbX="-8.750046mm"
            pcbY="0mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin6"]}
            pcbX="-8.750046mm"
            pcbY="-1.49987mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin7"]}
            pcbX="-8.750046mm"
            pcbY="-2.999994mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin8"]}
            pcbX="-8.750046mm"
            pcbY="-4.499864mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin9"]}
            pcbX="-8.750046mm"
            pcbY="-5.999988mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin10"]}
            pcbX="8.750046mm"
            pcbY="-5.999988mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin11"]}
            pcbX="8.750046mm"
            pcbY="-4.499864mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin12"]}
            pcbX="8.750046mm"
            pcbY="-2.999994mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin13"]}
            pcbX="8.750046mm"
            pcbY="-1.49987mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin14"]}
            pcbX="8.750046mm"
            pcbY="0mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin15"]}
            pcbX="8.750046mm"
            pcbY="1.500124mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin16"]}
            pcbX="8.750046mm"
            pcbY="2.999994mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin17"]}
            pcbX="8.750046mm"
            pcbY="4.500118mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin18"]}
            pcbX="8.750046mm"
            pcbY="5.999988mm"
            width="1.999996mm"
            height="0.999998mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin19"]}
            pcbX="-0.139954mm"
            pcbY="0.900176mm"
            width="0.6999986mm"
            height="0.6999986mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin19"]}
            pcbX="-0.139954mm"
            pcbY="-0.199898mm"
            width="0.6999986mm"
            height="0.6999986mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin19"]}
            pcbX="-0.139954mm"
            pcbY="-1.299972mm"
            width="0.6999986mm"
            height="0.6999986mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin19"]}
            pcbX="0.959866mm"
            pcbY="0.900176mm"
            width="0.6999986mm"
            height="0.6999986mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin19"]}
            pcbX="0.959866mm"
            pcbY="-0.199898mm"
            width="0.6999986mm"
            height="0.6999986mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin19"]}
            pcbX="0.959866mm"
            pcbY="-1.299972mm"
            width="0.6999986mm"
            height="0.6999986mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin19"]}
            pcbX="2.05994mm"
            pcbY="-1.299972mm"
            width="0.6999986mm"
            height="0.6999986mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin19"]}
            pcbX="2.05994mm"
            pcbY="-0.199898mm"
            width="0.6999986mm"
            height="0.6999986mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin19"]}
            pcbX="2.05994mm"
            pcbY="0.900176mm"
            width="0.6999986mm"
            height="0.6999986mm"
            shape="rect"
          />
          <silkscreenpath
            route={[
              { x: 9.000007399999959, y: 6.654241200000001 },
              { x: 9.000007399999959, y: 13.100100800000064 },
              { x: -9.000007400000072, y: 13.100100800000064 },
              { x: -9.000007400000072, y: 6.654241200000001 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -9.000007400000072, y: 7.100087400000007 },
              { x: 9.000007399999959, y: 7.100087400000007 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -9.000007400000072, y: -6.654038000000014 },
              { x: -9.000007400000072, y: -6.899909999999977 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -9.000007400000072, y: -5.15409180000006 },
              { x: -9.000007400000072, y: -5.345785599999999 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -9.000007400000072, y: -3.6540948000000526 },
              { x: -9.000007400000072, y: -3.8457885999999917 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -9.000007400000072, y: -2.154097800000045 },
              { x: -9.000007400000072, y: -2.345791599999984 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -9.000007400000072, y: -0.6540499999998701 },
              { x: -9.000007400000072, y: -0.8457691999999497 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -9.000007400000072, y: 0.8459723999999369 },
              { x: -9.000007400000072, y: 0.6542278000000579 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -9.000007400000072, y: 2.3458931999999777 },
              { x: -9.000007400000072, y: 2.154224800000179 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -9.000007400000072, y: 3.845915600000012 },
              { x: -9.000007400000072, y: 3.654221800000073 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -9.000007400000072, y: 5.345912599999906 },
              { x: -9.000007400000072, y: 5.154218799999967 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 9.000007399999959, y: 5.154218799999967 },
              { x: 9.000007399999959, y: 5.345912599999906 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 9.000007399999959, y: 3.654221800000073 },
              { x: 9.000007399999959, y: 3.845915600000012 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 9.000007399999959, y: 2.154224800000179 },
              { x: 9.000007399999959, y: 2.3458931999999777 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 9.000007399999959, y: 0.6542278000000579 },
              { x: 9.000007399999959, y: 0.8459723999999369 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 9.000007399999959, y: -0.8457691999999497 },
              { x: 9.000007399999959, y: -0.6540499999998701 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 9.000007399999959, y: -2.345791599999984 },
              { x: 9.000007399999959, y: -2.154097800000045 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 9.000007399999959, y: -3.8457885999999917 },
              { x: 9.000007399999959, y: -3.6540948000000526 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: 9.000007399999959, y: -5.345785599999999 },
              { x: 9.000007399999959, y: -5.15409180000006 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -9.000007400000072, y: -6.899909999999977 },
              { x: 9.000007399999959, y: -6.899909999999977 },
              { x: 9.000007399999959, y: -6.654038000000014 },
            ]}
          />
          <silkscreencircle
            pcbX="-9.779mm"
            pcbY="7.366mm"
            radius="0.249936mm"
          />
          <silkscreentext
            text="ANTENNA"
            pcbX="-6.500114mm"
            pcbY="9.100058mm"
            anchorAlignment="bottom_left"
            fontSize="2.032mm"
          />
          <silkscreentext
            text="{NAME}"
            pcbX="-0.1397mm"
            pcbY="14.208mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <fabricationnotepath
            route={[
              { x: -9.100007199999823, y: 6.650024799999983 },
              { x: -9.100007199999823, y: 13.050012000000038 },
              { x: -8.950020199999926, y: 13.199998999999934 },
              { x: 8.89995680000004, y: 13.199998999999934 },
              { x: 9.099956399999883, y: 12.999999399999979 },
              { x: 9.099956399999883, y: 6.849999000000025 },
              { x: 8.89995680000004, y: 6.849999000000025 },
              { x: 8.89995680000004, y: 12.999999399999979 },
              { x: -8.90000759999998, y: 12.999999399999979 },
              { x: -8.90000759999998, y: 6.700012000000129 },
              { x: -8.90000759999998, y: 6.650024799999983 },
              { x: -9.100007199999823, y: 6.650024799999983 },
            ]}
            strokeWidth="0mm"
            isFilled
            hasStroke={false}
          />
          <courtyardoutline
            outline={[
              { x: -10.000043999999889, y: 13.349999199999957 },
              { x: 10.000044000000003, y: 13.349999199999957 },
              { x: 10.000044000000003, y: -7.149960799999917 },
              { x: -10.000043999999889, y: -7.149960799999917 },
              { x: -10.000043999999889, y: 13.349999199999957 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C2934560.obj?uuid=3af5773cc1904a9197e0ebbdc043a5ad",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C2934560.step?uuid=3af5773cc1904a9197e0ebbdc043a5ad",
        pcbRotationOffset: 0,
        modelOriginPosition: {
          x: 0.000025399999913133797,
          y: -3.1000192000000197,
          z: -0.01,
        },
      }}
      {...props}
    />
  )
}
