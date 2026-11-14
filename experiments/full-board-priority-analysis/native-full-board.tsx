import type { ReactElement } from "react"
import type { BoardProps, BusProps, AutoroutingPhaseProps, CopperPourProps, FanoutPourNetMap } from "@tscircuit/props"
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
  planeIntent: {
    zones: {
      name: string
      nativeName: string
      netName: string
      layer: string
      priority: number
      clearance: number
      useThermalReliefs: boolean
      unbroken: boolean
      sourceOutlines: { x: number; y: number }[][]
      outlines: { x: number; y: number }[][]
    }[]
    savedCopperImported: boolean
    skippedTeardrops: number
    sourceKeepouts: number
  }
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
 * no routed copper. Authored zones become fresh pours. Plane escapes precede
 * byte buses, remaining DDR signals and the rest of the board.
 */
export function NativeFullBoard({
  source,
  geometryOnly = false,
  fanout = false,
  planes = true,
  algorithmFn,
}: {
  source: FullBoardSource
  geometryOnly?: boolean
  fanout?: boolean
  planes?: boolean
  algorithmFn?: AutoroutingPhaseProps["algorithmFn"]
}): ReactElement {
  const bytes = [...new Set(source.nets.map((net) => net.group))].filter((group) => group.startsWith("byte")).sort()
  const zones = planes ? source.planeIntent.zones : []
  const planeNets = new Set(zones.filter((zone) => zone.unbroken && zone.outlines.length > 0).map((zone) => zone.netName))
  const phases = [...(planeNets.size ? ["plane_escape"] : []), ...bytes, "ddr_remaining", "board"]
  const phaseForNet = (net: FullBoardSource["nets"][number]): string =>
    net.group === "board" && planeNets.has(net.name) ? "plane_escape" : net.group
  const planeLayers = new Map<string, { layer: keyof FanoutPourNetMap; area: number }>()
  for (const zone of zones.filter((zone) => zone.unbroken)) {
    const area = zone.outlines.reduce((total, outline) => total + Math.abs(outline.reduce((sum, p, i) => {
      const next = outline[(i+1)%outline.length]
      return sum+p.x*next.y-next.x*p.y
    }, 0))/2, 0)
    if (area > (planeLayers.get(zone.netName)?.area ?? 0)) planeLayers.set(zone.netName, { layer: zone.layer as keyof FanoutPourNetMap, area })
  }
  const fanoutPourNetMap: FanoutPourNetMap = {}
  for (const [name, { layer }] of planeLayers) {
    const previous = fanoutPourNetMap[layer]
    fanoutPourNetMap[layer] = previous === undefined ? name : [...(Array.isArray(previous) ? previous : [previous]), name]
  }
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
            padding={0.7}
            autorouter="fanout"
            fanoutPourNetMap={fanoutPourNetMap}
            fanoutRoutingLayers={source.signalLayers as BusProps["pcbAllowedLayers"]}
          >
            <NativePart part={{ ...part, x: 0, y: 0 }} />
            {source.nets.filter((net) => net.routable && planeNets.has(net.name)).flatMap((net) =>
              net.members.filter((member) => member.startsWith(prefix)).map((member) => (
                <trace
                  key={member}
                  name={`ESC_${part.name}_${member.slice(prefix.length)}`}
                  from={member}
                  to={`net.${net.name}`}
                  thickness={net.escapeWidth}
                />
              )),
            )}
          </fanout>
        )
      })}
      {fanout && source.parts.flatMap((part) => {
        const isBga = (/bga/i.test(part.footprint) || part.pads.filter((pad) => /^[A-Z]+\d+$/.test(pad.nativePin)).length >= 64) && Object.keys(part.pinLabels).length >= 64
        if (!isBga) return []
        const prefix = `.${part.name} > .`
        return source.nets.filter((net) => net.routable && !planeNets.has(net.name)).flatMap((net) =>
          net.members.filter((member) => member.startsWith(prefix)).map((member) => (
            <trace
              key={member}
              name={`ESC_${part.name}_${member.slice(prefix.length)}`}
              from={member}
              to={getNearestExternalMember(source, member, net.members)}
              thickness={net.escapeWidth}
              routingPhaseIndex={phases.indexOf(phaseForNet(net))}
            />
          )),
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
          routingPhaseIndex={net.routable ? phases.indexOf(phaseForNet(net)) : undefined}
        />
      ))}
      {zones.flatMap((zone) => zone.outlines.map((outline, index) => (
        <copperpour
          key={`${zone.name}_${index}`}
          name={`${zone.name}_${index}`}
          connectsTo={`net.${zone.netName}`}
          layer={zone.layer as CopperPourProps["layer"]}
          outline={outline}
          clearance={zone.clearance}
          boardEdgeMargin={source.rules.appliedGlobalClearance}
          unbroken={zone.unbroken}
          useThermalReliefs={zone.useThermalReliefs}
        />
      )))}
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
