// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger";
import bugReportJson from "./bugreport119-4dc543.json";

export default () => {
	return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />;
};
