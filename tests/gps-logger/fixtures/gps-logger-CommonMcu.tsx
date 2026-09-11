import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react"
import { Microcontroller_RP2040 } from "@tscircuit/common"
import type { ChipProps } from "@tscircuit/props"

// Retain the library's electronics, but let tscircuit place every schematic
// symbol and section. Only PCB connector/debug positions are adjusted.
export function CommonMcu(): ReactNode[] {
  const circuit = Microcontroller_RP2040({ name: "MCU" })
  const positions: Record<string, [number, number]> = {
    J_USB: [-10, 22.8],
    R_CC1: [-10, 18],
    R_CC2: [-6, 19],
    D_VBUS: [-22, 14],
    R_USB1: [-4, 25],
    C_VBUS: [-16, 24],
    D_PWR: [-23, 22],
    R_PWR_LED: [-23, 19],
    TP_SWCLK: [-20, -24],
    TP_GND: [-16, -24],
    TP_SWDIO: [-12, -24],
    TP_3V3: [-8, -24],
  }
  return circuit.props.children.map(
    (child: ReactElement<ChipProps>, i: number) => {
      if (!child || typeof child !== "object") return child
      if (child.type === "silkscreentext") return null
      const p = child.props
      const position = positions[p.name]
      const placement: Partial<ChipProps> = {}
      if (p.pcbX !== undefined) {
        placement.pcbX = position?.[0] ?? Number(p.pcbX) - 10
        placement.pcbY = position?.[1] ?? p.pcbY
      }
      return cloneElement(child, {
        key: `common-${i}`,
        schX: undefined,
        schY: undefined,
        schRotation: undefined,
        ...placement,
      })
    },
  )
}

export function automaticSchematic(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(automaticSchematic)
  if (!isValidElement<ChipProps>(node)) return node
  if (typeof node.type === "function") {
    const renderComponent = node.type as (props: ChipProps) => ReactNode
    return automaticSchematic(renderComponent(node.props))
  }
  const props = node.props
  const margins: Partial<ChipProps> = {}
  if (props.footprint) {
    margins.schMarginX = 0.8
    margins.schMarginY = 0.6
  }
  return cloneElement(node, {
    ...margins,
    children: automaticSchematic(props.children),
  })
}

// Reuse the library's verified tactile-switch footprint for the log button.
export function LogButton(): ReactElement<ChipProps> {
  const circuit = Microcontroller_RP2040({ name: "MCU" })
  const button: ReactElement<ChipProps> | undefined =
    circuit.props.children.find(
      (c: ReactElement<ChipProps>) => c?.props?.name === "SW_RUN",
    )
  if (!button) throw new Error("The RP2040 fixture requires the reset button")
  return cloneElement(button, {
    name: "SW_LOG",
    pcbX: 6,
    pcbY: -23,
    pcbRotation: 0,
    schX: undefined,
    schY: undefined,
    schRotation: undefined,
    schSectionName: "controls",
  })
}
