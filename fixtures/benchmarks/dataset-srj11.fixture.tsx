import sample001 from "dataset-srj11-45-degree/circuits/sample001.circuit.simple-route.json" with {
  type: "json",
}
import sample002 from "dataset-srj11-45-degree/circuits/sample002.circuit.simple-route.json" with {
  type: "json",
}
import sample003 from "dataset-srj11-45-degree/circuits/sample003.circuit.simple-route.json" with {
  type: "json",
}
import sample004 from "dataset-srj11-45-degree/circuits/sample004.circuit.simple-route.json" with {
  type: "json",
}
import sample005 from "dataset-srj11-45-degree/circuits/sample005.circuit.simple-route.json" with {
  type: "json",
}
import sample006 from "dataset-srj11-45-degree/circuits/sample006.circuit.simple-route.json" with {
  type: "json",
}
import sample007 from "dataset-srj11-45-degree/circuits/sample007.circuit.simple-route.json" with {
  type: "json",
}
import sample008 from "dataset-srj11-45-degree/circuits/sample008.circuit.simple-route.json" with {
  type: "json",
}
import sample009 from "dataset-srj11-45-degree/circuits/sample009.circuit.simple-route.json" with {
  type: "json",
}
import sample010 from "dataset-srj11-45-degree/circuits/sample010.circuit.simple-route.json" with {
  type: "json",
}
import sample011 from "dataset-srj11-45-degree/circuits/sample011.circuit.simple-route.json" with {
  type: "json",
}
import sample012 from "dataset-srj11-45-degree/circuits/sample012.circuit.simple-route.json" with {
  type: "json",
}
import sample013 from "dataset-srj11-45-degree/circuits/sample013.circuit.simple-route.json" with {
  type: "json",
}
import sample014 from "dataset-srj11-45-degree/circuits/sample014.circuit.simple-route.json" with {
  type: "json",
}
import sample015 from "dataset-srj11-45-degree/circuits/sample015.circuit.simple-route.json" with {
  type: "json",
}
import sample016 from "dataset-srj11-45-degree/circuits/sample016.circuit.simple-route.json" with {
  type: "json",
}
import sample017 from "dataset-srj11-45-degree/circuits/sample017.circuit.simple-route.json" with {
  type: "json",
}
import sample018 from "dataset-srj11-45-degree/circuits/sample018.circuit.simple-route.json" with {
  type: "json",
}
import sample019 from "dataset-srj11-45-degree/circuits/sample019.circuit.simple-route.json" with {
  type: "json",
}
import sample020 from "dataset-srj11-45-degree/circuits/sample020.circuit.simple-route.json" with {
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
  { id: "011", srj: sample011 },
  { id: "012", srj: sample012 },
  { id: "013", srj: sample013 },
  { id: "014", srj: sample014 },
  { id: "015", srj: sample015 },
  { id: "016", srj: sample016 },
  { id: "017", srj: sample017 },
  { id: "018", srj: sample018 },
  { id: "019", srj: sample019 },
  { id: "020", srj: sample020 },
] satisfies DatasetCircuit[]

export default () => (
  <DatasetBenchmarkFixture
    datasetLabel="dataset-srj11-45-degree"
    circuits={circuits}
  />
)
