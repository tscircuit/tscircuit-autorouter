/** @jsxImportSource react-for-pipeline9-fixtures */
import type { PushButtonProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["pin1"],
  pin2: ["pin2"],
  pin3: ["pin3"],
  pin4: ["pin4"]
} as const

export const PTS810SJG250SMTRLFS = (props: PushButtonProps<typeof pinLabels>) => {
  const { name = "SW1", ...restProps } = props

  return (
    <pushbutton
      name={name}
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C221895"
  ]
}}
      manufacturerPartNumber="PTS810SJG250SMTRLFS"
      footprint={<footprint>
        <smtpad portHints={["pin3"]} pcbX="-2.077212mm" pcbY="-1.083183mm" width="1.1999976mm" height="0.6500114mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="2.071116mm" pcbY="-1.074547mm" width="1.1999976mm" height="0.6500114mm" shape="rect" />
<smtpad portHints={["pin1"]} pcbX="-2.07772mm" pcbY="1.083183mm" width="1.1999976mm" height="0.6500114mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="2.07772mm" pcbY="1.075563mm" width="1.1999976mm" height="0.6500114mm" shape="rect" />
<silkscreenpath route={[{"x":1.9999959999999959,"y":1.6046957999999876},{"x":1.9999959999999959,"y":1.7499837999999812},{"x":-1.99999600000001,"y":1.7499837999999812}]} />
<silkscreenpath route={[{"x":1.9999959999999959,"y":-0.5454142000000104},{"x":1.9999959999999959,"y":0.5464047999999906}]} />
<silkscreenpath route={[{"x":-1.99999600000001,"y":-1.6123412000000172},{"x":-1.99999600000001,"y":-1.750009200000008},{"x":1.9999959999999959,"y":-1.750009200000008},{"x":1.9999959999999959,"y":-1.6037052000000074}]} />
<silkscreenpath route={[{"x":-1.99999600000001,"y":0.5540248000000076},{"x":-1.99999600000001,"y":-0.554050200000006}]} />
<silkscreenpath route={[{"x":-1.99999600000001,"y":1.7499837999999812},{"x":-1.99999600000001,"y":1.6123157999999904}]} />
<silkscreencircle pcbX="-0mm" pcbY="-0.000127mm" radius="0.999998mm" />
<silkscreentext text="{NAME}" pcbX="0.003302mm" pcbY="2.762633mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-2.927718799999994,"y":1.8499967999999996},{"x":2.927718799999994,"y":1.8499967999999996},{"x":2.927718799999994,"y":-1.8499968000000138},{"x":-2.927718799999994,"y":-1.8499968000000138},{"x":-2.927718799999994,"y":1.8499967999999996}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C221895.obj?uuid=06414145f7924824bd3a63e781c1d05c",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C221895.step?uuid=06414145f7924824bd3a63e781c1d05c",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: -0.000012699999999199463, y: 0, z: -0.1 },
      }}
      {...restProps}
    />
  )
}