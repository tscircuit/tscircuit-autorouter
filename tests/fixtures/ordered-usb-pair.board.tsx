// @ts-nocheck -- Capture source uses core fcc86d0's newer JSX catalogue.
/** @jsxImportSource react-for-pipeline9-fixtures */
// Captured by core's autorouter.algorithmFn, returning no copper.
// ordered-usb-pair.srj.json is the unmodified routing input.
// The artwork JSON retains only native silkscreen for the PCB render.
// Derived from core #5415: differential-pair-ordered-path-routing.test.tsx.
// USB D+/D- visit ESD before the MCU; TP1 branches from D+ outside the lane.
export const orderedUsbBoard = (
  <board width={30} height={18} schematicDisabled autorouter="auto_local">
    <chip
      name="J1"
      pcbX={-10}
      footprint="usbmicro"
      pcbRotation={90}
      pinLabels={{ pin2: "N", pin3: "P" }}
    />
    <chip name="ESD" footprint="sot23_6" pinLabels={{ pin1: "P", pin3: "N" }} />
    <chip
      name="MCU"
      pcbX={9}
      pcbY={2}
      footprint="qfp16"
      pinLabels={{ pin1: "P", pin3: "N" }}
    />
    <testpoint name="TP1" footprintVariant="pad" pcbX={-5} pcbY={5} />
    <trace name="D_P" path={["J1.P", "ESD.P", "MCU.P"]} />
    <trace name="D_N" path={["J1.N", "ESD.N", "MCU.N"]} />
    <trace name="tap" from="J1.P" to="TP1.pin1" />
    <differentialpair
      positiveConnection="D_P"
      negativeConnection="D_N"
      maxLengthSkew="0.1mm"
    />
  </board>
)
