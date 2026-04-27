import sample001 from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample001/sample001.circuit.simple-route.json" with {
  type: "json",
}
import sample002 from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample002/sample002.circuit.simple-route.json" with {
  type: "json",
}
import sample003 from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample003/sample003.circuit.simple-route.json" with {
  type: "json",
}
import sample004 from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample004/sample004.circuit.simple-route.json" with {
  type: "json",
}
import sample005 from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample005/sample005.circuit.simple-route.json" with {
  type: "json",
}
import sample006 from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample006/sample006.circuit.simple-route.json" with {
  type: "json",
}
import sample007 from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample007/sample007.circuit.simple-route.json" with {
  type: "json",
}
import sample008 from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample008/sample008.circuit.simple-route.json" with {
  type: "json",
}
import sample009 from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample009/sample009.circuit.simple-route.json" with {
  type: "json",
}
import sample010 from "@tsci/tscircuit.dataset-srj12-bus-routing/circuits/sample010/sample010.circuit.simple-route.json" with {
  type: "json",
}
import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

const circuits = [
  { id: "001", srj: sample001 },
  { id: "002", srj: sample002 },
  { id: "003", srj: sample003 },
  { id: "004", srj: sample004 },
  { id: "005", srj: sample005 },
  { id: "006", srj: sample006 },
  { id: "007", srj: sample007 },
  { id: "008", srj: sample008 },
  { id: "009", srj: sample009 },
  { id: "010", srj: sample010 },
] satisfies DatasetCircuit[]

export default () => (
  <DatasetBenchmarkFixture
    datasetLabel="dataset-srj12-bus-routing"
    circuits={circuits}
  />
)
