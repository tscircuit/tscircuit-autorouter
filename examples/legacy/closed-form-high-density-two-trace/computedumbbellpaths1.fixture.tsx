import { DumbbellDebugger } from "lib/testing/DumbbellDebugger"

const ComputeDumbbellPathsFixture1 = () => {
  return (
    <DumbbellDebugger
      A={{ x: 150, y: 250 }}
      B={{ x: 350, y: 250 }}
      C={{ x: 100, y: 100 }}
      D={{ x: 500, y: 100 }}
      E={{ x: 309, y: 106 }}
      F={{ x: 500, y: 400 }}
      radius={30}
      margin={15}
      subdivisions={1}
    />
  )
}

export default ComputeDumbbellPathsFixture1
