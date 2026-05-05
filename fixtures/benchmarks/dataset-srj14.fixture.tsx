import sample001 from "../datasets/dataset-srj14/sample01-source_net_5_mst1_0.srj.json" with {
  type: "json",
}
import sample002 from "../datasets/dataset-srj14/sample02-source_net_3_mst0_0.srj.json" with {
  type: "json",
}
import sample003 from "../datasets/dataset-srj14/sample03-source_net_5_mst0_0.srj.json" with {
  type: "json",
}
import sample004 from "../datasets/dataset-srj14/sample04-source_net_20_mst0_0.srj.json" with {
  type: "json",
}
import sample005 from "../datasets/dataset-srj14/sample05-source_net_20_mst2_0.srj.json" with {
  type: "json",
}
import sample006 from "../datasets/dataset-srj14/sample06-source_net_14_mst0_0.srj.json" with {
  type: "json",
}
import sample007 from "../datasets/dataset-srj14/sample07-source_net_23_mst1_0.srj.json" with {
  type: "json",
}
import sample008 from "../datasets/dataset-srj14/sample08-source_net_24_mst1_0.srj.json" with {
  type: "json",
}
import sample009 from "../datasets/dataset-srj14/sample09-source_net_19_mst1_0.srj.json" with {
  type: "json",
}
import sample010 from "../datasets/dataset-srj14/sample10-source_net_0_mst2_0.srj.json" with {
  type: "json",
}
import sample011 from "../datasets/dataset-srj14/sample11-source_net_11_0.srj.json" with {
  type: "json",
}
import sample012 from "../datasets/dataset-srj14/sample12-source_net_15_mst1_0.srj.json" with {
  type: "json",
}
import sample013 from "../datasets/dataset-srj14/sample13-source_net_15_mst2_0.srj.json" with {
  type: "json",
}
import sample014 from "../datasets/dataset-srj14/sample14-source_net_22_0.srj.json" with {
  type: "json",
}
import sample015 from "../datasets/dataset-srj14/sample15-source_net_1_mst2_0.srj.json" with {
  type: "json",
}
import sample016 from "../datasets/dataset-srj14/sample16-source_net_7_mst0_0.srj.json" with {
  type: "json",
}
import sample017 from "../datasets/dataset-srj14/sample17-source_net_13_mst0_0.srj.json" with {
  type: "json",
}
import sample018 from "../datasets/dataset-srj14/sample18-source_net_26_0.srj.json" with {
  type: "json",
}
import sample019 from "../datasets/dataset-srj14/sample19-source_net_12_mst0_0.srj.json" with {
  type: "json",
}
import sample020 from "../datasets/dataset-srj14/sample20-source_net_2_mst1_0.srj.json" with {
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
  <DatasetBenchmarkFixture datasetLabel="dataset-srj14" circuits={circuits} />
)
