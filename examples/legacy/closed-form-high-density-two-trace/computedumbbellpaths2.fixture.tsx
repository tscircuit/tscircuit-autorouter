import { DumbbellDebugger } from "lib/testing/DumbbellDebugger"

const ComputeDumbbellPathsFixture1 = () => {
  return (
    <DumbbellDebugger
      {...{
        A: {
          x: 144.84347778663028,
          y: 177.5,
        },
        B: {
          x: 247.5,
          y: 285.0000000000002,
        },
        C: {
          x: 240.625,
          y: 137.5,
          z: 0,
          connectionName: "source_trace_6",
        },
        D: {
          x: 100,
          y: 231.25,
          z: 0,
          connectionName: "source_trace_6",
        },
        E: {
          x: 146.875,
          y: 137.5,
          z: 0,
          connectionName: "source_net_0_mst1",
        },
        F: {
          x: 193.75,
          y: 325,
          z: 0,
          connectionName: "source_net_0_mst1",
        },
        radius: 30,
        margin: 10,
        subdivisions: 1,
      }}
    />
  )
}

export default ComputeDumbbellPathsFixture1
