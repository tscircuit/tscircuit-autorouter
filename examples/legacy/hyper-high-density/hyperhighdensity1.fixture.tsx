import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"

export default () => {
  const solver = new HyperSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "node1",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      portPoints: [
        { connectionName: "A", x: 0, y: 0, z: 0 },
        { connectionName: "B", x: 10, y: 10, z: 0 },
      ],
    },
    colorMap: { A: "red", B: "blue" },
  })
  return (
    <div>
      <p>
        These are all the hyperparameter combinations that would be run if we
        ran the supervisor solver.
      </p>
      <pre>
        {JSON.stringify(solver.getHyperParameterCombinations(), null, 2)}
      </pre>
    </div>
  )
}
