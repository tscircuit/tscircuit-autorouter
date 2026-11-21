/** @jsxImportSource react-for-pipeline9-fixtures */
import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["B1"],
  pin2: ["DTA1"],
  pin3: ["A1"],
  pin4: ["A2"],
  pin5: ["DTA2"],
  pin6: ["B2"],
  pin7: ["GND1"],
  pin8: ["GND2"],
  pin9: ["GND3"],
  pin10: ["GND4"],
  pin11: ["a"],
  pin12: ["c"],
  pin13: ["b"],
  pin14: ["d"]
} as const

const pinAttributes = {
  pin3: {requiresPower: true},
  pin4: {requiresPower: true},
  pin7: {requiresGround: true},
  pin8: {requiresGround: true},
  pin9: {requiresGround: true},
  pin10: {requiresGround: true}
} as const

export const RKJXV122400R = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      pinAttributes={pinAttributes}
      symbol={
        <symbol>
          <schematiccircle center={{ x: 0, y: 0 }} radius={0.4} strokeWidth={0.02} color="#880000" />
          <schematicrect schX={0} schY={0.5} width={0.52} height={0.2} strokeWidth={0.02} color="#880000" />
          <schematicrect schX={-0.5} schY={0} width={0.2} height={0.52} strokeWidth={0.02} color="#880000" />
          <port name="pin1" pinNumber={1} aliases={["B1"]} direction="left" schX={-0.8} schY={-0.2} schStemLength={0.2} />
          <port name="pin2" pinNumber={2} aliases={["DTA1"]} direction="left" schX={-0.8} schY={0} schStemLength={0.2} />
          <port name="pin3" pinNumber={3} aliases={["A1"]} direction="left" schX={-0.8} schY={0.2} schStemLength={0.2} />
          <port name="pin4" pinNumber={4} aliases={["A2"]} direction="up" schX={-0.2} schY={0.8} schStemLength={0.2} />
          <port name="pin5" pinNumber={5} aliases={["DTA2"]} direction="up" schX={0} schY={0.8} schStemLength={0.2} />
          <port name="pin6" pinNumber={6} aliases={["B2"]} direction="up" schX={0.2} schY={0.8} schStemLength={0.2} />
          <schematicpath points={[{"x":-0.4,"y":0.4},{"x":-0.28,"y":0.28}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-0.4,"y":0.4},{"x":-0.4,"y":0.6}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.4,"y":0.6},{"x":0.4,"y":0.4},{"x":0.28,"y":0.28}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0.4,"y":-0.6},{"x":0.4,"y":-0.4},{"x":0.28,"y":-0.28}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-0.4,"y":-0.6},{"x":-0.4,"y":-0.4},{"x":-0.28,"y":-0.28}]} strokeColor="#880000" />
          <port name="pin7" pinNumber={7} aliases={["GND1"]} direction="up" schX={-0.4} schY={0.8} schStemLength={0.2} />
          <port name="pin8" pinNumber={8} aliases={["GND2"]} direction="up" schX={0.4} schY={0.8} schStemLength={0.2} />
          <port name="pin9" pinNumber={9} aliases={["GND3"]} direction="down" schX={0.4} schY={-0.8} schStemLength={0.2} />
          <port name="pin10" pinNumber={10} aliases={["GND4"]} direction="down" schX={-0.4} schY={-0.8} schStemLength={0.2} />
          <schematiccircle center={{ x: 0, y: 0 }} radius={0.12} strokeWidth={0.02} color="#880000" />
          <schematicpath points={[{"x":-0.4,"y":-1},{"x":0.4,"y":-1}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0,"y":-1},{"x":0,"y":-1.2}]} strokeColor="#880000" />
          <schematicpath points={[{"x":-0.4,"y":-1.8},{"x":0.4,"y":-1.8}]} strokeColor="#880000" />
          <schematicpath points={[{"x":0,"y":-1.8},{"x":0,"y":-1.6}]} strokeColor="#880000" />
          <schematiccircle center={{ x: 0, y: -1.24 }} radius={0.04} strokeWidth={0.02} color="#880000" />
          <schematiccircle center={{ x: 0, y: -1.56 }} radius={0.04} strokeWidth={0.02} color="#880000" />
          <schematicpath points={[{"x":0.04,"y":-1.22},{"x":0.14,"y":-1.56}]} strokeColor="#880000" />
          <port name="pin11" pinNumber={11} aliases={["a"]} direction="left" schX={-0.6} schY={-1} schStemLength={0.2} />
          <port name="pin12" pinNumber={12} aliases={["c"]} direction="right" schX={0.6} schY={-1} schStemLength={0.2} />
          <port name="pin13" pinNumber={13} aliases={["b"]} direction="left" schX={-0.6} schY={-1.8} schStemLength={0.2} />
          <port name="pin14" pinNumber={14} aliases={["d"]} direction="right" schX={0.6} schY={-1.8} schStemLength={0.2} />
          <schematictext schX={-0.101} schY={1.022} text="{NAME}" fontSize={0.2} anchor="bottom_center" />
        </symbol>
      }
      supplierPartNumbers={{
  "jlcpcb": [
    "C918854"
  ]
}}
      manufacturerPartNumber="RKJXV122400R"
      footprint={<footprint insertionDirection="from_above">
        <hole pcbX="-5.32765635mm" pcbY="0.8809228mm" diameter="1.7999964mm" />
<hole pcbX="3.27227565mm" pcbY="0.8809228mm" diameter="1.7999964mm" />
<platedhole  portHints={["pin1"]} pcbX="7.70228965mm" pcbY="-1.6191992mm" outerDiameter="1.7999964mm" holeDiameter="1.1999976mm" shape="circle" />
<platedhole  portHints={["pin2"]} pcbX="7.70228965mm" pcbY="0.8809228mm" outerDiameter="1.7999964mm" holeDiameter="1.1999976mm" shape="circle" />
<platedhole  portHints={["pin3"]} pcbX="7.70228965mm" pcbY="3.3807908mm" outerDiameter="1.7999964mm" holeDiameter="1.1999976mm" shape="circle" />
<platedhole  portHints={["pin4"]} pcbX="1.47243165mm" pcbY="9.6109028mm" outerDiameter="1.7999964mm" holeDiameter="1.1999976mm" shape="circle" />
<platedhole  portHints={["pin5"]} pcbX="-1.02743635mm" pcbY="9.6109028mm" outerDiameter="1.7999964mm" holeDiameter="1.1999976mm" shape="circle" />
<platedhole  portHints={["pin6"]} pcbX="-3.52755835mm" pcbY="9.6109028mm" outerDiameter="1.7999964mm" holeDiameter="1.1999976mm" shape="circle" />
<platedhole  portHints={["pin7"]} pcbX="-7.35229035mm" pcbY="5.8809128mm" outerDiameter="2.499995mm" holeDiameter="1.7999964mm" shape="circle" />
<platedhole  portHints={["pin8"]} pcbX="-7.35229035mm" pcbY="-4.1190672mm" outerDiameter="2.499995mm" holeDiameter="1.7999964mm" shape="circle" />
<platedhole  portHints={["pin9"]} pcbX="5.29767165mm" pcbY="-4.1190672mm" outerDiameter="2.499995mm" holeDiameter="1.7999964mm" shape="circle" />
<platedhole  portHints={["pin10"]} pcbX="5.29767165mm" pcbY="5.8809128mm" outerDiameter="2.499995mm" holeDiameter="1.7999964mm" shape="circle" />
<platedhole  portHints={["pin11"]} pcbX="-4.54660635mm" pcbY="-4.9110392mm" outerDiameter="2.1999956mm" holeDiameter="1.5999968mm" shape="circle" />
<platedhole  portHints={["pin12"]} pcbX="2.45337965mm" pcbY="-4.9110392mm" outerDiameter="2.1999956mm" holeDiameter="1.5999968mm" shape="circle" />
<platedhole  portHints={["pin13"]} pcbX="-4.54660635mm" pcbY="-9.4109032mm" outerDiameter="2.1999956mm" holeDiameter="1.5999968mm" shape="circle" />
<platedhole  portHints={["pin14"]} pcbX="2.45337965mm" pcbY="-9.4109032mm" outerDiameter="2.1999956mm" holeDiameter="1.5999968mm" shape="circle" />
<silkscreenpath route={[{"x":-5.324963950000324,"y":-5.990310600000157},{"x":-5.324963950000324,"y":-8.331631800000082}]} />
<silkscreenpath route={[{"x":-7.574946750000208,"y":-5.650001400000178},{"x":-5.653284350000149,"y":-5.650001400000178}]} />
<silkscreenpath route={[{"x":-8.674944550000191,"y":5.217439399999876},{"x":-8.674944550000191,"y":-3.4555938000002016}]} />
<silkscreenpath route={[{"x":3.2750188499998103,"y":-6.099987800000235},{"x":3.2750188499998103,"y":-8.364296200000126}]} />
<silkscreenpath route={[{"x":5.525027049999721,"y":-5.699988600000097},{"x":3.5249040499998046,"y":-5.699988600000097}]} />
<silkscreenpath route={[{"x":8.325021449999667,"y":-2.5629870000001347},{"x":8.325021449999667,"y":-3.3500060000001213},{"x":7.8250224499997785,"y":-3.850005000000124},{"x":6.754133049999837,"y":-3.850005000000124}]} />
<silkscreenpath route={[{"x":8.325021449999667,"y":-0.06286500000010165},{"x":8.325021449999667,"y":-0.6754114000001437}]} />
<silkscreenpath route={[{"x":8.325021449999667,"y":2.4370029999998906},{"x":8.325021449999667,"y":1.8247105999998894}]} />
<silkscreenpath route={[{"x":6.760660849999795,"y":5.649975999999924},{"x":7.775035249999746,"y":5.649975999999924},{"x":8.325021449999667,"y":5.099989800000003},{"x":8.325021449999667,"y":4.324578599999882}]} />
<silkscreenpath route={[{"x":2.368797649999806,"y":10.299979399999756},{"x":3.225031649999778,"y":10.299979399999756},{"x":3.7250306499997805,"y":9.799980399999868},{"x":3.7250306499997805,"y":7.449972399999979},{"x":5.525027049999721,"y":7.449972399999979},{"x":5.525027049999721,"y":7.344460799999865}]} />
<silkscreenpath route={[{"x":-0.1310703500003001,"y":10.299979399999756},{"x":0.5760656499998049,"y":10.299979399999756}]} />
<silkscreenpath route={[{"x":-2.6311923500001058,"y":10.299979399999756},{"x":-1.9238023500001873,"y":10.299979399999756}]} />
<silkscreenpath route={[{"x":-7.574946750000208,"y":7.449972399999979},{"x":-5.774950350000154,"y":7.449972399999979},{"x":-5.774950350000154,"y":9.749993200000063},{"x":-5.224964150000233,"y":10.299979399999756},{"x":-4.42392435000022,"y":10.299979399999756}]} />
<silkscreenpath route={[{"x":-3.9913115500000913,"y":-10.619054200000164},{"x":1.8980848499998046,"y":-10.619054200000164}]} />
<silkscreenpath route={[{"x":6.1806518499997765,"y":4.694453399999816},{"x":6.1726508499998545,"y":4.686452399999894}]} />
<silkscreenpath route={[{"x":6.1806518499997765,"y":-2.932607800000028},{"x":6.1726508499998545,"y":-2.924606800000106}]} />
<silkscreenpath route={[{"x":6.1726508499998545,"y":4.686452399999894},{"x":6.1726508499998545,"y":-2.924606800000106}]} />
<silkscreenpath route={[{"x":-4.527327750000268,"y":1.8809207999997852},{"x":2.4726582499997676,"y":1.8809207999997852}]} />
<silkscreenpath route={[{"x":-4.5274547500001745,"y":-0.11983720000011999},{"x":2.4726582499997676,"y":-0.1190751999999975}]} />
<silkscreenpath route={[{"x":-2.2773195500001293,"y":1.8809207999997852},{"x":-2.2773195500001293,"y":3.130930999999805},{"x":0.22267544999976963,"y":3.130930999999805},{"x":0.22267544999976963,"y":1.8809207999997852}]} />
<silkscreenpath route={[{"x":0.2200846499997624,"y":-0.11666220000006433},{"x":0.2200846499997624,"y":-1.3666723999999704},{"x":-2.27991035000025,"y":-1.3666723999999704},{"x":-2.27991035000025,"y":-0.11666220000006433}]} />
<silkscreenpath route={[{"x":-2.727331350000213,"y":-7.319060800000102},{"x":0.5726620499997352,"y":-7.319060800000102},{"x":0.5726620499997352,"y":-8.51903300000015},{"x":-2.727331350000213,"y":-8.51903300000015},{"x":-2.727331350000213,"y":-7.319060800000102}]} />
<silkscreenpath route={[{"x":-2.028094750000264,"y":-6.319977200000039},{"x":-2.028094750000264,"y":-9.218117200000052},{"x":-0.026574750000236236,"y":-9.218117200000052},{"x":-0.026574750000236236,"y":-6.319977200000039},{"x":-0.1281747500001984,"y":-6.319977200000039}]} />
<silkscreencircle pcbX="-1.02565835mm" pcbY="0.8793988mm" radius="3.633724mm" />
<silkscreencircle pcbX="-1.02769035mm" pcbY="0.8809228mm" radius="0.976376mm" />
<silkscreencircle pcbX="-1.02769035mm" pcbY="0.8809228mm" radius="6.100064mm" />
<silkscreentext text="VR1" pcbX="5.51763565mm" pcbY="2.1897848mm" anchorAlignment="bottom_left" pcbRotation="90deg" fontSize="0.999998mm" />
<silkscreentext text="VR2" pcbX="-5.62813835mm" pcbY="7.2347328mm" anchorAlignment="bottom_left" fontSize="0.999998mm" />
<silkscreentext text="{NAME}" pcbX="-0.10694035mm" pcbY="11.6688128mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-8.874957350000273,"y":10.849978799999917},{"x":8.92500804999986,"y":10.849978799999917},{"x":8.92500804999986,"y":-10.949978600000122},{"x":-8.874957350000273,"y":-10.949978600000122},{"x":-8.874957350000273,"y":10.849978799999917}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C918854.obj?uuid=d517a47582614e8e9dc732fb054ae010",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C918854.step?uuid=d517a47582614e8e9dc732fb054ae010",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 1.0249751500001496, y: -0.8999990999998975, z: -11.4000044 },
      }}
      {...props}
    />
  )
}