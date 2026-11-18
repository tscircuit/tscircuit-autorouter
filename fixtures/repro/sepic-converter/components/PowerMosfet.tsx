/** @jsxImportSource ../jsx */
import type { ReactElement } from "react"
import { IRL540NPBF } from "../imports/IRL540NPBF/IRL540NPBF"

export function PowerMosfet(): ReactElement {
  return (
    <IRL540NPBF
      name="Q1"
      pcbX={-9}
      pcbY={-2}
      pcbRotation={270}
      schX={-0.7}
      schY={1.4}
      schSectionName="Power"
      connections={{ drain: "net.SW", source: "net.SENSE" }}
    />
  )
}
