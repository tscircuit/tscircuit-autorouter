import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["FB_B1"],
  pin2: ["LX_B1_1"],
  pin3: ["LX_B1_2"],
  pin4: ["PVIN_B1_1"],
  pin5: ["PVIN_B1_2"],
  pin6: ["PVIN_LDO1"],
  pin7: ["VLDO1"],
  pin8: ["GPO1"],
  pin9: ["SDA"],
  pin10: ["SCL"],
  pin11: ["nINT"],
  pin12: ["VSEL_SD_VSEL_DDR"],
  pin13: ["VSYS"],
  pin14: ["VDD1P8"],
  pin15: ["AGND"],
  pin16: ["GPIO"],
  pin17: ["GPO2"],
  pin18: ["nRSTOUT"],
  pin19: ["VLDO2"],
  pin20: ["PVIN_LDO2"],
  pin21: ["VLDO3"],
  pin22: ["PVIN_LDO34"],
  pin23: ["VLDO4"],
  pin24: ["FB_B3"],
  pin25: ["EN_PB_VSENSE"],
  pin26: ["PVIN_B3"],
  pin27: ["LX_B3"],
  pin28: ["MODE_RESET"],
  pin29: ["LX_B2"],
  pin30: ["PVIN_B2"],
  pin31: ["MODE_STBY"],
  pin32: ["FB_B2"],
  pin33: ["GND"]
} as const

export const TPS6521908RHBR = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C22466609"
  ]
}}
      manufacturerPartNumber="TPS6521908RHBR"
      footprint={<footprint>
        <smtpad portHints={["pin33"]} pcbX="-0mm" pcbY="-0mm" width="3.499993mm" height="3.499993mm" shape="rect" />
<smtpad portHints={["pin32"]} pcbX="-1.75006mm" pcbY="2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin31"]} pcbX="-1.249934mm" pcbY="2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin30"]} pcbX="-0.750062mm" pcbY="2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin29"]} pcbX="-0.249936mm" pcbY="2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin28"]} pcbX="0.249936mm" pcbY="2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin27"]} pcbX="0.750062mm" pcbY="2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin26"]} pcbX="1.249934mm" pcbY="2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin25"]} pcbX="1.75006mm" pcbY="2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin24"]} pcbX="2.407412mm" pcbY="1.75006mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin23"]} pcbX="2.407412mm" pcbY="1.249934mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin22"]} pcbX="2.407412mm" pcbY="0.750062mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin21"]} pcbX="2.407412mm" pcbY="0.249936mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin20"]} pcbX="2.407412mm" pcbY="-0.249936mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin19"]} pcbX="2.407412mm" pcbY="-0.750062mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin18"]} pcbX="2.407412mm" pcbY="-1.249934mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin17"]} pcbX="2.407412mm" pcbY="-1.75006mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin16"]} pcbX="1.75006mm" pcbY="-2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin15"]} pcbX="1.249934mm" pcbY="-2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin14"]} pcbX="0.750062mm" pcbY="-2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin13"]} pcbX="0.249936mm" pcbY="-2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin12"]} pcbX="-0.249936mm" pcbY="-2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin11"]} pcbX="-0.750062mm" pcbY="-2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin10"]} pcbX="-1.249934mm" pcbY="-2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin9"]} pcbX="-1.75006mm" pcbY="-2.407412mm" width="0.2800096mm" height="0.6649974mm" shape="rect" />
<smtpad portHints={["pin8"]} pcbX="-2.407412mm" pcbY="-1.75006mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin7"]} pcbX="-2.407412mm" pcbY="-1.249934mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin6"]} pcbX="-2.407412mm" pcbY="-0.750062mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin5"]} pcbX="-2.407412mm" pcbY="-0.249936mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin4"]} pcbX="-2.407412mm" pcbY="0.249936mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin3"]} pcbX="-2.407412mm" pcbY="0.750062mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="-2.407412mm" pcbY="1.249934mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<smtpad portHints={["pin1"]} pcbX="-2.407412mm" pcbY="1.75006mm" width="0.6649974mm" height="0.2800096mm" shape="rect" />
<silkscreenpath route={[{"x":2.08056479999982,"y":2.576118799999904},{"x":2.576296599999978,"y":2.576118799999904},{"x":2.576296599999978,"y":2.0803869999999733}]} />
<silkscreenpath route={[{"x":2.08056479999982,"y":-2.5763220000001184},{"x":2.576296599999978,"y":-2.5763220000001184},{"x":2.576296599999978,"y":-2.080590200000074}]} />
<silkscreenpath route={[{"x":-2.0804124,"y":2.576118799999904},{"x":-2.5761442000000443,"y":2.576118799999904},{"x":-2.5761442000000443,"y":2.0803869999999733}]} />
<silkscreenpath route={[{"x":-2.0804124,"y":-2.5763220000001184},{"x":-2.5761442000000443,"y":-2.5763220000001184},{"x":-2.5761442000000443,"y":-2.080590200000074}]} />
<silkscreenpath route={[{"x":-2.964941999999951,"y":1.7500599999998485},{"x":-2.967495177836099,"y":1.7306666889503504},{"x":-2.9749807164944286,"y":1.7125949999999648},{"x":-2.986888488885711,"y":1.6970764888857275},{"x":-3.002407000000062,"y":1.6851687164943314},{"x":-3.0204786889505613,"y":1.677683177836002},{"x":-3.0398720000000594,"y":1.6751299999999674},{"x":-3.0592653110495576,"y":1.677683177836002},{"x":-3.077336999999943,"y":1.6851687164943314},{"x":-3.092855511114294,"y":1.6970764888857275},{"x":-3.1047632835055765,"y":1.7125949999999648},{"x":-3.112248822163906,"y":1.7306666889503504},{"x":-3.1148020000000542,"y":1.7500599999998485},{"x":-3.112248822163906,"y":1.7694533110493467},{"x":-3.1047632835055765,"y":1.7875249999999596},{"x":-3.092855511114294,"y":1.803043511114197},{"x":-3.077336999999943,"y":1.814951283505593},{"x":-3.0592653110495576,"y":1.8224368221639224},{"x":-3.0398720000000594,"y":1.824989999999957},{"x":-3.0204786889505613,"y":1.8224368221639224},{"x":-3.002407000000062,"y":1.814951283505593},{"x":-2.986888488885711,"y":1.803043511114197},{"x":-2.9749807164944286,"y":1.7875249999999596},{"x":-2.967495177836099,"y":1.7694533110493467},{"x":-2.964941999999951,"y":1.7500599999998485}]} />
<silkscreentext text="{NAME}" pcbX="-0.19304mm" pcbY="3.751582mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-3.3767400000000407,"y":3.001581999999985},{"x":2.9906599999999344,"y":3.001581999999985},{"x":2.9906599999999344,"y":-2.9848179999999047},{"x":-3.3767400000000407,"y":-2.9848179999999047},{"x":-3.3767400000000407,"y":3.001581999999985}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C22466609.obj?uuid=5d917b47fb5b45ab82ceefc3d062447a",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C22466609.step?uuid=5d917b47fb5b45ab82ceefc3d062447a",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: -0.00007619999985308823, y: 0.00010160000010728254, z: -0.05 },
      }}
      {...props}
    />
  )
}
