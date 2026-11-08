import { Fragment, type ReactElement } from "react"
import { applyToPoint, compose, rotateDEG, scale } from "transformation-matrix"
import source from "../h3-ddr-strobe-via-access/source.json"

type H3Part = (typeof source.parts)[number]

/** KiCad-local pad points use mm, +X right and +Y down. Convert to Core's
 * right-handed local frame (+X right, +Y up), then apply native placement. */
export function NativeH3Part({ part }: { part: H3Part }): ReactElement {
  const pinLabels: Record<string, string[]> = {}
  for (const [pin, labels] of Object.entries(part.pinLabels)) {
    if (!labels) throw new Error(`Missing aliases for ${part.name}.${pin}`)
    pinLabels[pin] = labels
  }
  const transform = compose(rotateDEG(part.rotation), scale(1, -1))
  const footprint = (
    <footprint originalLayer={part.layer as "top" | "bottom"}>
      {part.pads.map((pad, padIndex) => {
        const point = applyToPoint(transform, { x: pad.x, y: pad.y })
        const placement = {
          pcbX: point.x,
          pcbY: point.y,
          portHints: [pad.pin],
        }
        let primitive: ReactElement
        if (pad.shape === "circle") {
          primitive = (
            <smtpad {...placement} shape="circle" radius={pad.width / 2} />
          )
        } else {
          primitive = (
            <smtpad
              {...placement}
              shape="rotated_rect"
              width={pad.width}
              height={pad.height}
              ccwRotation={pad.rotation}
            />
          )
        }
        return <Fragment key={padIndex}>{primitive}</Fragment>
      })}
    </footprint>
  )
  if (part.name === "R1") {
    return (
      <resistor
        name={part.name}
        resistance={part.value}
        footprint={footprint}
        pcbX={part.x}
        pcbY={part.y}
        layer={part.layer as "top" | "bottom"}
      />
    )
  }
  return (
    <chip
      name={part.name}
      manufacturerPartNumber={part.value}
      pinLabels={pinLabels}
      footprint={footprint}
      pcbX={part.x}
      pcbY={part.y}
      layer={part.layer as "top" | "bottom"}
      noSchematicRepresentation
    />
  )
}
