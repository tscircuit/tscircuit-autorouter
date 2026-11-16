/** @jsxImportSource ../../jsx */
import type { ReactElement } from "react"
import type { ResistorProps } from "@tscircuit/props-for-sepic-repro"

export const A_25121WF120MT4E = (props: Omit<ResistorProps, "resistance">): ReactElement => {
  const { name = "R1", ...restProps } = props

  return (
    <resistor
      name={name}
      resistance="12mohm"
      supplierPartNumbers={{
        jlcpcb: ["C406965"],
      }}
      manufacturerPartNumber="25121WF120MT4E"
      footprint={
        <footprint>
          <smtpad
            portHints={["pin2"]}
            pcbX="3.066288mm"
            pcbY="0mm"
            width="1.2825222mm"
            height="3.4560002mm"
            shape="rect"
          />
          <smtpad
            portHints={["pin1"]}
            pcbX="-3.066288mm"
            pcbY="0mm"
            width="1.2825222mm"
            height="3.4560002mm"
            shape="rect"
          />
          <silkscreenpath
            route={[
              { x: 2.501188799999909, y: -1.9565873999999894 },
              { x: 3.9361363999998957, y: -1.9565873999999894 },
              { x: 3.9361363999998957, y: 1.9565874000001031 },
              { x: 2.501188799999909, y: 1.9565874000001031 },
            ]}
          />
          <silkscreenpath
            route={[
              { x: -2.5011888000001363, y: -1.9565873999999894 },
              { x: -3.9361364000000094, y: -1.9565873999999894 },
              { x: -3.9361364000000094, y: 1.9565874000001031 },
              { x: -2.5011888000001363, y: 1.9565874000001031 },
            ]}
          />
          <silkscreentext
            text="{NAME}"
            pcbX="0mm"
            pcbY="2.9558mm"
            anchorAlignment="center"
            fontSize="1mm"
          />
          <courtyardoutline
            outline={[
              { x: -3.957549100000051, y: 1.9780001000000311 },
              { x: 3.9575490999999374, y: 1.9780001000000311 },
              { x: 3.9575490999999374, y: -1.9780001000000311 },
              { x: -3.957549100000051, y: -1.9780001000000311 },
              { x: -3.957549100000051, y: 1.9780001000000311 },
            ]}
          />
        </footprint>
      }
      cadModel={{
        objUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C406965.obj?uuid=311a5ea298274ff3b9740151e78a7465",
        stepUrl:
          "https://modelcdn.tscircuit.com/easyeda_models/assets/C406965.step?uuid=311a5ea298274ff3b9740151e78a7465",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0.000012700000070253736, y: 0, z: 0 },
      }}
      {...restProps}
    />
  )
}
