/** @jsxImportSource ../jsx */
import type { ReactElement } from "react"
import { A_0603WAF6651T5E } from "../imports/A_0603WAF6651T5E/A_0603WAF6651T5E"
import { A_0603WAF2002T5E } from "../imports/A_0603WAF2002T5E/A_0603WAF2002T5E"
import { EEUFR1H221 } from "../imports/EEUFR1H221/EEUFR1H221"
import { GRM32ER71H106KA12L } from "../imports/GRM32ER71H106KA12L/GRM32ER71H106KA12L"
import { KF301_5_0_2P } from "../imports/KF301_5_0_2P/KF301_5_0_2P"
import { A_3296W_1_104LF } from "../imports/A_3296W_1_104LF/A_3296W_1_104LF"
export function OutputAdjustment(): ReactElement {
  return (
    <>
      <schematicsection
        name="Output"
        displayName="5–24 V adjustable output / 1 A target"
      />
      <EEUFR1H221
        name="C9"
        maxVoltageRating="50V"
        polarized
        pcbX={19.5}
        pcbY={-6}
        schX={7.0}
        schY={4.2}
        schRotation={-90}
        schSectionName="Output"
        connections={{ pin1: "net.VOUT", pin2: "net.GND" }}
      />
      <GRM32ER71H106KA12L
        name="C10"
        maxVoltageRating="50V"
        pcbX={9}
        pcbY={-10}
        pcbRotation={180}
        schX={8.61}
        schY={4.2}
        schRotation={-90}
        schSectionName="Output"
        connections={{ pin1: "net.VOUT", pin2: "net.GND" }}
      />
      <KF301_5_0_2P
        name="J2"
        pcbStyle={{ silkscreenTextVisibility: "hidden" }}
        pcbX={23}
        pcbY={5.5}
        pcbRotation={90}
        schPinArrangement={{ topSide: ["pin1"], bottomSide: ["pin2"] }}
        schX={10.15}
        schY={4.9}
        schSectionName="Output"
        connections={{ pin1: "net.VOUT", pin2: "net.GND" }}
      />
      <trace
        name="TrimmerAdjustmentRoute"
        from=".R8 > .pin2"
        to=".P1 > .pin1"
        thickness="0.15mm"
        pcbPath={[{ x: 0.753364, y: -7.5396308 }]}
      />
      <A_0603WAF2002T5E
        name="R8"
        pcbX={12.6}
        pcbY={-7.5}
        schX={9.8}
        schY={2.8}
        schRotation={-90}
        schSectionName="Output"
        connections={{ pin1: "net.VOUT" }}
      />
      <trace
        name="TrimmerFeedbackReturn"
        from=".R9 > .pin1"
        to=".P1 > .pin2"
        thickness="0.2mm"
        pcbPath={[
          { x: -1.053364, y: 0.3 },
          { x: -6.6329948, y: 0.3 },
        ]}
      />
      {/* On-board 100k multi-turn trimmer; tie the wiper to end B. */}
      <A_3296W_1_104LF
        name="P1"
        pcbX={15}
        pcbY={-16}
        pcbRotation={90}
        schX={9.8}
        schY={1.05}
        schSectionName="Output"
        connections={{ pin1: "net.ADJ", pin2: "net.FB", pin3: "net.FB" }}
      />
      <A_0603WAF6651T5E
        name="R9"
        pcbX={7}
        pcbY={-17}
        schX={9.8}
        schY={-1.05}
        schRotation={-90}
        schSectionName="Output"
        connections={{ pin1: "net.FB", pin2: "net.GND" }}
        pcbRotation={180}
      />
      <schematictext
        text="P1: on-board 100k multi-turn trimmer; 5.05–24.00 V nominal"
        schX={8.4}
        schY={-2.8}
        fontSize={0.18}
      />
    </>
  )
}
