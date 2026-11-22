// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger";
import bugReportJson from "./bugreport113-76a505.json";

export default () => {
	return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />;
};
