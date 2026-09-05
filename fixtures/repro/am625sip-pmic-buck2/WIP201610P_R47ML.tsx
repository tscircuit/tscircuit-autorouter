import type { ChipProps } from "@tscircuit/props"

const pinLabels = {
  pin1: ["pin1"],
  pin2: ["pin2"]
} as const

export const WIP201610P_R47ML = (props: ChipProps<typeof pinLabels>) => {
  return (
    <chip
      pinLabels={pinLabels}
      supplierPartNumbers={{
  "jlcpcb": [
    "C964105"
  ]
}}
      manufacturerPartNumber="WIP201610P_R47ML"
      footprint={<footprint>
        <smtpad portHints={["pin1"]} pcbX="-0.899922mm" pcbY="0mm" width="0.7999984mm" height="1.999996mm" shape="rect" />
<smtpad portHints={["pin2"]} pcbX="0.899922mm" pcbY="0mm" width="0.7999984mm" height="1.999996mm" shape="rect" />
<silkscreenpath route={[{"x":-0.45539659999997184,"y":-1.1430000000001428},{"x":0.45529499999997824,"y":-1.1430000000001428}]} />
<silkscreenpath route={[{"x":-0.45539659999997184,"y":1.1429999999999154},{"x":0.45529499999997824,"y":1.1429999999999154}]} />
<silkscreentext text="{NAME}" pcbX="-0.008636mm" pcbY="2.143mm" anchorAlignment="center" fontSize="1mm" />
<courtyardoutline outline={[{"x":-1.5540359999999964,"y":1.3929999999999154},{"x":1.5367639999999483,"y":1.3929999999999154},{"x":1.5367639999999483,"y":-1.3930000000001428},{"x":-1.5540359999999964,"y":-1.3930000000001428},{"x":-1.5540359999999964,"y":1.3929999999999154}]} />
      </footprint>}
      cadModel={{
        objUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C964105.obj?uuid=84510a2326f14fa7994472a46feb64ad",
        stepUrl: "https://modelcdn.tscircuit.com/easyeda_models/assets/C964105.step?uuid=84510a2326f14fa7994472a46feb64ad",
        pcbRotationOffset: 0,
        modelOriginPosition: { x: 0, y: 0, z: -0.01 },
      }}
      {...props}
    />
  )
}