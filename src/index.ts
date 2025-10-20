import server from "./server";

export { IngestWorkflow } from "./workflows/IngestWorkflow";

export default {
	fetch: server.fetch,
} satisfies ExportedHandler<Env>;
