import server from "./server";

export { OrchestrationAgent } from "./agents/OrchestrationAgent";
export { IngestWorkflow } from "./workflows/IngestWorkflow";

export default {
	fetch: server.fetch,
} satisfies ExportedHandler<Env>;
