import { DumbbellDebugger } from "lib/testing/DumbbellDebugger"

const ComputeDumbbellPathsFixture1 = () => {
  const scale = 50
  const offsetX = 7000 // Shifts coordinates to 0-500 range
  const offsetY = 0 // Y values are already in a good range when scaled
  return (
    <DumbbellDebugger
      {...{
        A: {
          x: -134.66412427893638 * scale + offsetX,
          y: 5.335875721063611 * scale + offsetY,
        },
        B: {
          x: -135.33587572106362 * scale + offsetX,
          y: 4.664124278936391 * scale + offsetY,
        },
        C: {
          x: -133.33333333333334 * scale + offsetX,
          y: 10 * scale + offsetY,
          z: 0,
          connectionName: "connectivity_net9",
        },
        D: {
          x: -140 * scale + offsetX,
          y: 3.333333333333333 * scale + offsetY,
          z: 0,
          connectionName: "connectivity_net9",
        },
        E: {
          x: -136.66666666666666 * scale + offsetX,
          y: 10 * scale + offsetY,
          z: 0,
          connectionName: "connectivity_net6",
        },
        F: {
          x: -140 * scale + offsetX,
          y: 1.6666666666666665 * scale + offsetY,
          z: 0,
          connectionName: "connectivity_net6",
        },
        radius: 0.47500000000000003 * scale,
        margin: 0.1 * scale,
        subdivisions: 1,
      }}
    />
  )
}

export default ComputeDumbbellPathsFixture1
