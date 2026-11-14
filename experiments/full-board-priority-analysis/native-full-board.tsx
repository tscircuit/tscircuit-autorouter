import type { ReactElement } from "react"
import type { BoardProps, BusProps, AutoroutingPhaseProps } from "@tscircuit/props"
import { NativePart, type NativePartData } from "./native-part"

export type FullBoardSource = {
  id: string
  title: string
  width: number
  height: number
  outline: { x: number; y: number }[]
  layers: number
  signalLayers: string[]
  rules: { widths: number[]; appliedGlobalClearance: number; viaPad: number; viaDrill: number }
  parts: NativePartData[]
  nets: { name: string; nativeName: string; members: string[]; width: number; escapeWidth: number; clearance: number; group: string; routable: boolean; isGround: boolean }[]
}

function getNearestExternalMember(source: FullBoardSource, member: string, members: string[]): string {
  const positions = new Map<string, { x: number; y: number }>()
  for (const part of source.parts) for (const pad of part.pads) {
    if (pad.pin) positions.set(`.${part.name} > .${pad.pin}`, { x: part.x+pad.x, y: part.y+pad.y })
  }
  const componentPrefix = member.slice(0, member.indexOf(" > .")) + " > ."
  const point = positions.get(member)!
  const candidates = members.filter((candidate) => candidate !== member)
  if (!candidates.length) throw new Error(`No handoff destination for ${member}`)
  candidates.sort((a, b) => {
    const external = Number(a.startsWith(componentPrefix))-Number(b.startsWith(componentPrefix))
    if (external) return external
    const pa = positions.get(a)!, pb = positions.get(b)!
    return Math.hypot(pa.x-point.x, pa.y-point.y)-Math.hypot(pb.x-point.x, pb.y-point.y)
  })
  return candidates[0]
}

/** Full native net membership, not an ordered daisy chain. The source contains
 * no routed copper. Core generates BGA fanout, then byte buses, then remaining
 * DDR signals, then every other board net including the power distribution.
 */
export function NativeFullBoard({
  source,
  geometryOnly = false,
  fanout = false,
  algorithmFn,
}: {
  source: FullBoardSource
  geometryOnly?: boolean
  fanout?: boolean
  algorithmFn?: AutoroutingPhaseProps["algorithmFn"]
}): ReactElement {
  const bytes = [...new Set(source.nets.map((net) => net.group))].filter((group) => group.startsWith("byte")).sort()
  const phases = [...bytes, "ddr_remaining", "board"]
  return (
    <board
      title={`${source.title} — full circuit`}
      width={source.width}
      height={source.height}
      outline={source.outline}
      layers={source.layers as BoardProps["layers"]}
      schematicDisabled
      placementDrcChecksDisabled
      routingDisabled={geometryOnly}
      routeRemaining={false}
      isViaInPadAllowed={false}
      allowBlindAndBuriedVias={false}
      minTraceWidth={Math.min(...source.nets.filter((net) => net.routable).map((net) => net.width))}
      minTraceToPadEdgeClearance={source.rules.appliedGlobalClearance}
      minViaEdgeToPadEdgeClearance={source.rules.appliedGlobalClearance}
      minViaPadDiameter={source.rules.viaPad}
      minViaHoleDiameter={source.rules.viaDrill}
      pcbStyle={{ viaPadDiameter: source.rules.viaPad, viaHoleDiameter: source.rules.viaDrill }}
    >
      {source.parts.map((part) => {
        const isBga = (/bga/i.test(part.footprint) || part.pads.filter((pad) => /^[A-Z]+\d+$/.test(pad.nativePin)).length >= 64) && Object.keys(part.pinLabels).length >= 64
        if (!isBga || !fanout) return <NativePart key={part.name} part={part} />
        const prefix = `.${part.name} > .`
        return (
          <fanout
            key={part.name}
            name={`FANOUT_${part.name}`}
            pcbX={part.x}
            pcbY={part.y}
            padding={1}
            autorouter="fanout"
            fanoutRoutingLayers={source.signalLayers as BusProps["pcbAllowedLayers"]}
          >
            <NativePart part={{ ...part, x: 0, y: 0 }} />
            {source.nets.filter((net) => net.routable).flatMap((net) =>
              net.members.filter((member) => member.startsWith(prefix)).map((member) => (
                <trace
                  key={member}
                  name={`ESC_${part.name}_${member.slice(prefix.length)}`}
                  from={member}
                  to={getNearestExternalMember(source, member, net.members)}
                  thickness={net.escapeWidth}
                />
              )),
            )}
          </fanout>
        )
      })}
      {phases.map((group, phaseIndex) => (
        <autoroutingphase
          key={group}
          name={group}
          phaseIndex={phaseIndex}
          autorouter={bytes.includes(group) ? "bus_lanes" : "auto_local"}
          algorithmFn={bytes.includes(group) ? undefined : algorithmFn}
        />
      ))}
      {source.nets.map((net) => (
        <net
          key={net.name}
          name={net.name}
          connectsTo={net.members}
          nominalTraceWidth={net.width}
          isGroundNet={net.isGround}
          routingPhaseIndex={net.routable ? phases.indexOf(net.group) : undefined}
        />
      ))}
      {bytes.map((group) => (
        <bus
          key={group}
          name={`DDR_BUS_${group}`}
          connections={source.nets.filter((net) => net.group === group).map((net) => {
            if (!fanout) return net.members[0]
            const bgaMember = net.members.find((member) => source.parts.some((part) =>
              (/bga/i.test(part.footprint) || part.pads.filter((pad) => /^[A-Z]+\d+$/.test(pad.nativePin)).length >= 64) && Object.keys(part.pinLabels).length >= 64 && member.startsWith(`.${part.name} > .`),
            ))
            if (!bgaMember) throw new Error(`No BGA endpoint for byte bus ${net.nativeName}`)
            const match = /^\.(\S+) > \.(\S+)$/.exec(bgaMember)!
            return `ESC_${match[1]}_${match[2]}`
          })}
          routingPhaseIndex={phases.indexOf(group)}
          pcbAllowedLayers={source.signalLayers as BusProps["pcbAllowedLayers"]}
        />
      ))}
    </board>
  )
}
