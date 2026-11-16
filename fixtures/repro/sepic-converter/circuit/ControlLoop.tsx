/** @jsxImportSource ../jsx */
import type { ReactElement } from "react"
import { A_0603WAF1000T5E } from "../imports/A_0603WAF1000T5E/A_0603WAF1000T5E"
import { A_0603WAF1003T5E } from "../imports/A_0603WAF1003T5E/A_0603WAF1003T5E"
import { A_0603WAF2201T5E } from "../imports/A_0603WAF2201T5E/A_0603WAF2201T5E"
import { A_0805W8F200JT5E } from "../imports/A_0805W8F200JT5E/A_0805W8F200JT5E"
import { CL10B102KB8NNNC } from "../imports/CL10B102KB8NNNC/CL10B102KB8NNNC"
import { CL10B472KB8NNNC } from "../imports/CL10B472KB8NNNC/CL10B472KB8NNNC"
import { CL21A475KAQNNNE } from "../imports/CL21A475KAQNNNE/CL21A475KAQNNNE"
import { CL21B105KBFNNNE } from "../imports/CL21B105KBFNNNE/CL21B105KBFNNNE"
import { LM3478MA_NOPB } from "../imports/LM3478MA_NOPB/LM3478MA_NOPB"
export function ControlLoop(): ReactElement {
  return (
    <>
      <schematicsection
        name="Control"
        displayName="LM3478 controller and compensation"
      />
      <trace
        name="AnalogGroundReturn"
        from=".U1 > .AGND"
        to=".C5 > .pin2"
        thickness="0.25mm"
        pcbPath={[{ x: 1.905, y: -4.095 }]}
      />
      <trace
        name="FeedbackSenseRoute"
        from=".U1 > .FB"
        to=".R9 > .pin1"
        thickness="0.15mm"
        pcbPath={[
          { x: 1.8425, y: 0.5415946785 },
          { x: 3.05, y: 1.4 },
          { x: 7.68245028626, y: 6.03245028626 },
          { x: 8.10644242465, y: 6.45644242465 },
          { x: 8.10644242465, y: 11.64692157535 },
        ]}
      />
      <trace
        name="CompensationRoute"
        from=".U1 > .COMP"
        to=".R6 > .pin1"
        thickness="0.15mm"
        pcbPath={[
          {
            x: -0.635,
            y: -4.1,
            via: true,
            fromLayer: "top",
            toLayer: "bottom",
          },
          { x: -0.635, y: 2.565 },
          { x: 1, y: 4.2, via: true, fromLayer: "bottom", toLayer: "top" },
        ]}
      />
      <LM3478MA_NOPB
        name="U1"
        schPinArrangement={{
          leftSide: ["VIN", "FB", "COMP", "FA"],
          rightSide: ["DR", "ISEN", "PGND", "AGND"],
        }}
        pcbX={-5}
        pcbY={-10}
        pcbRotation={270}
        schX={-2.1}
        schY={-5.6}
        schSectionName="Control"
        connections={{
          VIN: "net.VCC",
          FA: "net.FREQ",
          DR: "net.DRIVE",
          ISEN: "net.ISEN",
          PGND: "net.GND",
        }}
      />
      <A_0805W8F200JT5E
        name="R2"
        pcbX={-16}
        pcbY={-11}
        schX={-7.0}
        schY={-3.5}
        schRotation={-90}
        schSectionName="Control"
        connections={{ pin1: "net.VIN", pin2: "net.VCC" }}
      />
      <CL21B105KBFNNNE
        name="C5"
        maxVoltageRating="25V"
        pcbX={-11}
        pcbY={-11}
        schX={-4.9}
        schY={-5.6}
        schRotation={-90}
        schSectionName="Control"
        connections={{ pin1: "net.VCC", pin2: "net.GND" }}
      />
      <A_0603WAF1003T5E
        name="R3"
        pcbX={0.6}
        pcbY={-7}
        schX={-4.9}
        schY={-7.7}
        schRotation={-90}
        schSectionName="Control"
        connections={{ pin1: "net.FREQ", pin2: "net.GND" }}
      />
      <A_0603WAF1000T5E
        name="R5"
        pcbX={-8}
        pcbY={-14.8}
        schX={1.4}
        schY={-3.5}
        schRotation={180}
        schSectionName="Control"
        connections={{ pin1: "net.SENSE", pin2: "net.ISEN" }}
      />
      <CL10B102KB8NNNC
        name="C6"
        pcbX={-4}
        pcbY={-15}
        schX={3.5}
        schY={-5.6}
        schRotation={-90}
        schSectionName="Control"
        connections={{ pin1: "net.ISEN", pin2: "net.GND" }}
      />
      <A_0603WAF2201T5E
        name="R6"
        pcbX={1}
        pcbY={-11}
        schX={-3.5}
        schY={-9.8}
        schRotation={180}
        schSectionName="Control"
        connections={{ pin1: "net.COMP", pin2: "net.COMP_RC" }}
      />
      <CL21A475KAQNNNE
        name="C7"
        maxVoltageRating="10V"
        pcbX={4}
        pcbY={-13}
        schX={-1.4}
        schY={-9.8}
        schRotation={-90}
        schSectionName="Control"
        connections={{ pin1: "net.COMP_RC", pin2: "net.GND" }}
      />
      <CL10B472KB8NNNC
        name="C8"
        pcbX={1}
        pcbY={-15}
        schX={1.4}
        schY={-9.8}
        schRotation={-90}
        schSectionName="Control"
        connections={{ pin1: "net.COMP", pin2: "net.GND" }}
      />
      <schematictext
        text="U1: SEPIC PWM controller, 12 V input; about 191 kHz"
        schX={-2.1}
        schY={-11.55}
        fontSize={0.18}
      />
    </>
  )
}
