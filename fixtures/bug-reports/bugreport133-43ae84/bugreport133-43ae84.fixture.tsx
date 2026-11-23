// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger";
import bugReportJson from "./bugreport133-43ae84.json";

export default () => {
	return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />;
};
