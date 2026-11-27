// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger";
import bugReportJson from "./bugreport131-93b336.json";

export default () => {
	return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />;
};
