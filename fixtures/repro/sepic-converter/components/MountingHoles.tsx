/** @jsxImportSource ../jsx */
import type { ReactElement } from "react"
import { Fragment } from "../jsx/jsx-runtime"

const mountingHoles = [
  { name: "H1", pcbX: -24, pcbY: 18 },
  { name: "H2", pcbX: 24, pcbY: 18 },
  { name: "H3", pcbX: -24, pcbY: -18 },
  { name: "H4", pcbX: 24, pcbY: -18 },
]

export function MountingHoles(): ReactElement {
  return (
    <>
      {mountingHoles.map(({ name, pcbX, pcbY }) => (
        <Fragment key={name}>
          <hole name={name} diameter="3.2mm" pcbX={pcbX} pcbY={pcbY} />
          <keepout
            shape="circle"
            radius="3.2mm"
            pcbX={pcbX}
            pcbY={pcbY}
            layers={["top", "bottom"]}
            excludeRefs={[`.${name}`]}
          />
        </Fragment>
      ))}
    </>
  )
}
