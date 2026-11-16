/** @jsxImportSource ../jsx */
import type { ReactElement } from "react"
import type { CommonLayoutProps } from "@tscircuit/props-for-sepic-repro"
import { SRP1265A_470M } from "../imports/SRP1265A_470M/SRP1265A_470M"

interface PowerInductorProps extends CommonLayoutProps {
  name: string
  schSectionName: string
  connections: { pin1: string; pin2: string }
}

export function PowerInductor(props: PowerInductorProps): ReactElement {
  return <SRP1265A_470M {...props} maxCurrentRating="6.5A" />
}
