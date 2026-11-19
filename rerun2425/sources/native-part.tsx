import { Fragment, type ReactElement } from "react"

export type NativePad = {
  pin: string | null
  nativePin: string
  kind: string
  shape: string
  sourceNet: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  cornerRadius: number
  drillWidth?: number
  drillHeight?: number
  drillOffset?: { x: number; y: number }
  points?: { x: number; y: number }[]
}

export type NativePartData = {
  name: string
  nativeReference: string
  value: string
  footprint: string
  x: number
  y: number
  layer: string
  pinLabels: Record<string, string[] | undefined>
  pads: NativePad[]
  silkscreen: { x: number; y: number }[][]
}

/** Native positions are already rotated into the board's right-handed frame.
 * originalLayer prevents bottom-side pads from being reflected a second time.
 * Generic chips preserve arbitrary source pinouts and values without inventing
 * simulation models for processors, connectors or unpopulated components.
 */
export function NativePart({ part }: { part: NativePartData }): ReactElement {
  const pinLabels: Record<string, string[]> = Object.fromEntries(Object.entries(part.pinLabels).map(([pin, labels]) => {
    if (!labels) throw new Error(`Missing native pin aliases: ${part.name}.${pin}`)
    return [pin, labels]
  }))
  return (
    <chip
      name={part.name}
      manufacturerPartNumber={part.value}
      pinLabels={pinLabels}
      pcbX={part.x}
      pcbY={part.y}
      layer={part.layer as "top" | "bottom"}
      noSchematicRepresentation
      pcbStyle={{ silkscreenTextPosition: "none" }}
      footprint={
        <footprint originalLayer={part.layer as "top" | "bottom"}>
          {part.pads.map((pad, index) => {
            const placement = { pcbX: pad.x, pcbY: pad.y, portHints: pad.pin ? [pad.pin] : [] }
            const holeWidth = pad.drillWidth!
            const holeHeight = pad.drillHeight!
            let primitive: ReactElement
            if (pad.kind === "np_thru_hole") {
              primitive = holeWidth === holeHeight
                ? <hole pcbX={pad.x} pcbY={pad.y} diameter={holeWidth} />
                : <hole pcbX={pad.x} pcbY={pad.y} shape="pill" width={holeWidth} height={holeHeight} pcbRotation={pad.rotation} />
            } else if (pad.kind === "thru_hole") {
              if (pad.shape === "circle" && holeWidth === holeHeight) {
                primitive = <platedhole {...placement} shape="circle" outerDiameter={pad.width} holeDiameter={holeWidth} />
              } else if (pad.shape === "oval") {
                primitive = <platedhole {...placement} shape="pill" outerWidth={pad.width} outerHeight={pad.height} holeWidth={holeWidth} holeHeight={holeHeight} pcbRotation={pad.rotation} holeOffsetX={pad.drillOffset!.x} holeOffsetY={pad.drillOffset!.y} />
              } else if (holeWidth !== holeHeight) {
                primitive = <platedhole {...placement} shape="pill_hole_with_rect_pad" rectPadWidth={pad.width} rectPadHeight={pad.height} holeWidth={holeWidth} holeHeight={holeHeight} pcbRotation={pad.rotation} rectBorderRadius={pad.cornerRadius} holeOffsetX={pad.drillOffset!.x} holeOffsetY={pad.drillOffset!.y} />
              } else {
                primitive = <platedhole {...placement} shape="circular_hole_with_rect_pad" rectPadWidth={pad.width} rectPadHeight={pad.height} holeDiameter={holeWidth} pcbRotation={pad.rotation} rectBorderRadius={pad.cornerRadius} holeOffsetX={pad.drillOffset!.x} holeOffsetY={pad.drillOffset!.y} />
              }
            } else if (pad.shape === "circle") {
              primitive = <smtpad {...placement} shape="circle" radius={pad.width / 2} />
            } else if (pad.shape === "oval") {
              primitive = <smtpad {...placement} shape="rotated_pill" width={pad.width} height={pad.height} radius={Math.min(pad.width, pad.height) / 2} ccwRotation={pad.rotation} />
            } else if (pad.shape === "custom") {
              if (!pad.points) throw new Error(`Missing custom polygon for ${part.name}.${pad.nativePin}`)
              primitive = <smtpad {...placement} shape="polygon" points={pad.points} />
            } else if (pad.shape === "rect" || pad.shape === "roundrect") {
              primitive = <smtpad {...placement} shape="rotated_rect" width={pad.width} height={pad.height} ccwRotation={pad.rotation} cornerRadius={pad.cornerRadius} />
            } else {
              throw new Error(`Unsupported pad shape ${part.name}.${pad.nativePin}: ${pad.shape}`)
            }
            return <Fragment key={index}>{primitive}</Fragment>
          })}
          {part.silkscreen.map((points, index) => (
            <silkscreenpath key={`silk${index}`} route={points} strokeWidth={0.12} />
          ))}
        </footprint>
      }
    />
  )
}
