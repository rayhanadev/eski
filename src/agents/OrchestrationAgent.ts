import { Agent } from "agents";
import { DAG, type JSONGraph } from "../utils/dag";
import type { TaskMetadata } from "../workflows/IngestWorkflow";

export class OrchestrationAgent extends Agent {
	async onStart() {
		console.log("");
	}

	async handoff(graph: JSONGraph<string, TaskMetadata>) {
		const dag = DAG.fromJSON(graph);

		console.log(dag);
	}
}
