// @ts-nocheck -- Captured with core fcc86d0; its JSX catalogue is newer than this repo's pinned core.
/** @jsxImportSource react-for-pipeline9-fixtures */
// Same layout as core #5412, tests/utils/autorouting/trace-path-order.test.tsx.
// Captured with core fcc86d0's autorouter.algorithmFn (returning no copper).
export const orderedTracePathBoard = (
  <board width={19} height={13} schematicDisabled autorouter="auto_local">
    <pinheader name="A" pinCount={2} pcbX={-6} pcbY={-2} pcbRotation={90} />
    <pinheader name="B" pinCount={2} pcbX={6} pcbY={-2} pcbRotation={90} />
    <pinheader name="C" pinCount={2} pcbY={3} pcbRotation={90} />
    <trace path={["C.pin1", "A.pin1", "B.pin1"]} />
  </board>
)
