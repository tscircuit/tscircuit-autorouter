/** @jsxImportSource ../jsx */
import type { ReactElement } from "react"
import { A_0603WAF1003T5E } from "../imports/A_0603WAF1003T5E/A_0603WAF1003T5E"
import { A_0603WAF100JT5E } from "../imports/A_0603WAF100JT5E/A_0603WAF100JT5E"
import { A_25121WF120MT4E } from "../imports/A_25121WF120MT4E/A_25121WF120MT4E"
import { GRM32ER71H106KA12L } from "../imports/GRM32ER71H106KA12L/GRM32ER71H106KA12L"
import { SS510C } from "../imports/SS510C/SS510C"
import { PowerInductor } from "../components/PowerInductor"
import { PowerMosfet } from "../components/PowerMosfet"

export function SepicPowerStage(): ReactElement {
  return (
    <>
      <schematicsection name="Power" displayName="SEPIC" />
      <PowerInductor
        name="L1"
        pcbX={-10}
        pcbY={8.5}
        schX={0.0}
        schY={4.9}
        schSectionName="Power"
        connections={{ pin1: "net.VIN", pin2: "net.SW" }}
      />
      <PowerInductor
        name="L2"
        pcbX={6}
        pcbY={8.5}
        schX={4.2}
        schY={2.45}
        schRotation={-90}
        schSectionName="Power"
        connections={{ pin1: "net.SEPIC", pin2: "net.GND" }}
      />
      <GRM32ER71H106KA12L
        name="C3"
        maxVoltageRating="50V"
        pcbX={-1}
        pcbY={0.3}
        schX={2.1}
        schY={4.9}
        schOrientation="vertical"
        schSectionName="Power"
        connections={{ pin1: "net.SW", pin2: "net.SEPIC" }}
      />
      <GRM32ER71H106KA12L
        name="C4"
        maxVoltageRating="50V"
        pcbX={-0.5}
        pcbY={-3.5}
        schX={3.5}
        schY={4.9}
        schOrientation="vertical"
        schSectionName="Power"
        connections={{ pin1: "net.SW", pin2: "net.SEPIC" }}
      />
      <PowerMosfet />
      {/* Keep the gate clear of the high-current switch-node fanout. */}
      <trace
        name="GatePath"
        from=".Q1 > .G"
        to=".R7 > .pin1"
        thickness="0.2mm"
        pcbPath={[
          { x: 2, y: 1.94000125 },
          { x: 2.81336275, y: 2.753364 },
        ]}
      />
      <trace
        name="GatePulldownReturn"
        from=".R7 > .pin2"
        to=".Q1 > .S"
        thickness="0.2mm"
        pcbPath={[{ x: 1.13999875, y: 0 }]}
      />
      <A_0603WAF100JT5E
        name="R4"
        pcbX={-3}
        pcbY={-5.8}
        pcbRotation={180}
        schX={-2.8}
        schY={1.4}
        schSectionName="Power"
        connections={{ pin1: "net.DRIVE", pin2: "net.GATE" }}
      />
      <A_0603WAF1003T5E
        name="R7"
        pcbX={-7}
        pcbY={-6}
        schX={-2.8}
        schY={-0.56}
        schSectionName="Power"
        connections={{ pin1: "net.GATE" }}
        pcbRotation={180}
      />

      <A_25121WF120MT4E
        name="R1"
        pcbX={-13.2}
        pcbY={-7}
        schX={-0.7}
        schY={-0.56}
        schRotation={-90}
        schSectionName="Power"
        connections={{ pin1: "net.SENSE", pin2: "net.GND" }}
      />
      <SS510C
        name="D1"
        pcbX={8}
        pcbY={-2}
        pcbRotation={180}
        schX={5.6}
        schY={4.9}
        schRotation={90}
        schSectionName="Power"
        connections={{ anode: "net.SEPIC", cathode: "net.VOUT" }}
      />
      <schematictext
        text="Q1: 100 V N-MOSFET, G-D-S; heatsink required"
        schX={0.7}
        schY={-1.9}
        fontSize={0.18}
      />
    </>
  )
}
