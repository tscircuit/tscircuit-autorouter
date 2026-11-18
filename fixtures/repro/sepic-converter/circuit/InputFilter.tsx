/** @jsxImportSource ../jsx */
import type { ReactElement } from "react"
import { EEUFR1E101 } from "../imports/EEUFR1E101/EEUFR1E101"
import { GRM32ER71H106KA12L } from "../imports/GRM32ER71H106KA12L/GRM32ER71H106KA12L"
import { KF301_5_0_2P } from "../imports/KF301_5_0_2P/KF301_5_0_2P"
export function InputFilter(): ReactElement {
  return (
    <>
      <schematicsection name="Input" displayName="12 V input" />
      <KF301_5_0_2P
        name="J1"
        pcbStyle={{ silkscreenTextVisibility: "hidden" }}
        pcbX={-23}
        pcbY={5.5}
        pcbRotation={270}
        schPinArrangement={{ topSide: ["pin1"], bottomSide: ["pin2"] }}
        schX={-9.35}
        schY={4.55}
        schSectionName="Input"
        connections={{ pin1: "net.VIN", pin2: "net.GND" }}
      />
      <trace
        name="InputGroundReturn"
        from=".C1 > .pin2"
        to=".R1 > .pin2"
        thickness="1.2mm"
        pcbPath={[
          { x: 1.27, y: 6 },
          { x: -11.866288, y: 6 },
        ]}
      />
      <EEUFR1E101
        name="C1"
        maxVoltageRating="25V"
        polarized
        pcbX={-22}
        pcbY={-7}
        schX={-7.95}
        schY={4.55}
        schRotation={-90}
        schSectionName="Input"
        connections={{ pin1: "net.VIN" }}
        pcbRotation={180}
      />
      <GRM32ER71H106KA12L
        name="C2"
        maxVoltageRating="50V"
        pcbX={-16.7}
        pcbY={18}
        pcbRotation={90}
        schX={-5.92}
        schY={4.55}
        schRotation={-90}
        schSectionName="Input"
        connections={{ pin1: "net.VIN", pin2: "net.GND" }}
      />
    </>
  )
}
