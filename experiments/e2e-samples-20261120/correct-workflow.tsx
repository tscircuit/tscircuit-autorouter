import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react"
import type { BoardProps, BusProps } from "@tscircuit/props"
import type { FullBoardSource } from "./samples/h616-original"
import type { NativeFullBoardSource } from "./samples/h616-spaced"

type NativeNetName = FullBoardSource["nets"][number]["nativeName"]
type PortSelector = NativeFullBoardSource["traces"][number]["path"][number]
type NativePart = NativeFullBoardSource["parts"][number]
type PartName = NativePart["name"]
type Position = { x: number; y: number }
type RoutingChildProps = {
  children?: ReactNode
  part?: NativePart
  phaseIndex?: number
  routingPhaseIndex?: number
  name?: string
  autorouter?: string
  connections?: string[]
}
type NativeBoardProps = {
  source: FullBoardSource | NativeFullBoardSource
  fanout?: boolean
  geometryOnly?: boolean
}
type RenderedBoard = ReactElement<BoardProps & { children?: ReactNode }>

function getEscapeName(member: PortSelector): string {
  const match = /^\.(\S+) > \.(\S+)$/.exec(member)
  if (!match) {
    throw new Error(`Unsupported native port selector: ${member}`)
  }
  return `ESC_${match[1]}_${match[2]}`
}

function getNearestExternalMember({ member, members, positions }: {
  member: PortSelector
  members: PortSelector[]
  positions: ReadonlyMap<PortSelector, Position>
}): PortSelector {
  const prefix = member.slice(0, member.indexOf(" > .")) + " > ."
  const point = positions.get(member)!
  const candidates = members.filter((candidate) => candidate !== member)
  if (!candidates.length) throw new Error(`No handoff destination for ${member}`)
  candidates.sort((left, right) => {
    const samePart = Number(left.startsWith(prefix)) - Number(right.startsWith(prefix))
    if (samePart) return samePart
    const a = positions.get(left)!
    const b = positions.get(right)!
    return Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y)
  })
  return candidates[0]
}

function orderBusPhasesFirst(board: RenderedBoard): RenderedBoard {
  const children = Children.toArray(board.props.children)
  const phases = children.filter((child): child is ReactElement<RoutingChildProps> =>
    isValidElement<RoutingChildProps>(child) && child.type === "autoroutingphase",
  )
  const ordered = [...phases].sort((left, right) =>
    Number(left.props.autorouter !== "bus_lanes") - Number(right.props.autorouter !== "bus_lanes"),
  )
  const phaseIndexes = new Map(ordered.map((phase, index) => [phase.props.phaseIndex!, index]))
  return cloneElement(board, {}, children.map((child) => {
    if (!isValidElement<RoutingChildProps>(child)) return child
    if (child.type === "autoroutingphase") {
      return cloneElement(child, { phaseIndex: phaseIndexes.get(child.props.phaseIndex!)! })
    }
    if (child.props.routingPhaseIndex !== undefined) {
      return cloneElement(child, { routingPhaseIndex: phaseIndexes.get(child.props.routingPhaseIndex)! })
    }
    return child
  }))
}

/** Routing setup only for the supplied NativeFullBoard exports. All native
 * pad vectors stay in board-world mm (+X right, +Y up); translating a BGA into
 * a fanout group adds its authored position exactly once. Spaced escape widths
 * come from the paired original's explicit escapeWidth, never a new default.
 */
export function getCorrectWorkflowBoard(boardElement: ReactElement, options: {
  escapeWidthsByNativeNet?: ReadonlyMap<NativeNetName, number>
} = {}): ReactElement {
  const nativeBoard = boardElement as ReactElement<NativeBoardProps>
  const render = nativeBoard.type as (props: NativeBoardProps) => RenderedBoard
  const source = nativeBoard.props.source
  let board = render({ ...nativeBoard.props, fanout: true })
  if ("nets" in source) return orderBusPhasesFirst(board)
  if (!options.escapeWidthsByNativeNet) {
    throw new Error("Spaced fanout requires the paired original's escape widths")
  }

  const bgaNames = new Set<PartName>(source.parts.filter((part) =>
    part.pads.filter((pad) => /^[A-Z]+\d+$/.test(pad.nativePin)).length >= 64 &&
    Object.keys(part.pinLabels).length >= 64,
  ).map((part) => part.name))
  const positions = new Map<PortSelector, Position>()
  for (const part of source.parts) for (const pad of part.pads) {
    if (pad.pin) positions.set(`.${part.name} > .${pad.pin}`, { x: part.x + pad.x, y: part.y + pad.y })
  }
  const children = Children.toArray(board.props.children)
  const phases = children.filter((child): child is ReactElement<RoutingChildProps> =>
    isValidElement<RoutingChildProps>(child) && child.type === "autoroutingphase",
  )
  const escapes = source.traces.filter((trace) => trace.path.length > 1).flatMap((trace) => {
    const width = options.escapeWidthsByNativeNet!.get(trace.nativeNet)
    if (width === undefined) throw new Error(`Missing original escape width for ${trace.nativeNet}`)
    const phase = phases.find((phase) => phase.props.name === trace.group)
    if (!phase) throw new Error(`Missing authored routing phase for ${trace.nativeNet}`)
    return trace.path.filter((member) => [...bgaNames].some((name) => member.startsWith(`.${name} > .`))).map((member) =>
      <trace key={member} name={getEscapeName(member)} from={member}
        to={getNearestExternalMember({ member, members: trace.path, positions })}
        thickness={width} routingPhaseIndex={phase.props.phaseIndex} />,
    )
  })
  board = cloneElement(board, {}, children.map((child) => {
    if (!isValidElement<RoutingChildProps>(child)) return child
    const part = child.props.part
    if (part && bgaNames.has(part.name)) {
      return <fanout key={part.name} name={`FANOUT_${part.name}`} pcbX={part.x} pcbY={part.y}
        padding={0.7} autorouter="fanout" fanoutRoutingLayers={source.signalLayers as BusProps["pcbAllowedLayers"]}>
        {cloneElement(child, { part: { ...part, x: 0, y: 0 } })}
      </fanout>
    }
    if (child.type !== "bus") return child
    return cloneElement(child, { connections: child.props.connections!.map((selector) => {
      const trace = source.traces.find((trace) => trace.path[0] === selector)!
      const bgaMember = trace.path.find((member) => [...bgaNames].some((name) => member.startsWith(`.${name} > .`)))
      if (!bgaMember) throw new Error(`No BGA endpoint for byte bus ${trace.nativeNet}`)
      return getEscapeName(bgaMember)
    }) })
  }), escapes)
  return orderBusPhasesFirst(board)
}
