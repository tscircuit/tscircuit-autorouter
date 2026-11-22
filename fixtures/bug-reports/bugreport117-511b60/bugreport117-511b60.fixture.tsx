// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger";
import bugReportJson from "./bugreport117-511b60.json";

export default () => {
	return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />;
};
