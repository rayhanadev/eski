import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
} from "cloudflare:workers";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";

import * as z from "zod";

import { DAG } from "../utils/dag";
import { INGEST_WORKFLOW_OCR_SYSTEM_PROMPT } from "../utils/prompts";

export type Params = {
	imageUrl: string;
};

export class IngestWorkflow extends WorkflowEntrypoint<Env, Params> {
	async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
		console.info(`starting workflow: ${event.instanceId}`);
		const tasks = await step.do("extract tasks from image", async () => {
			console.log("Extracting tasks from image...");
			const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });
			const result = await generateObject({
				model: openai("gpt-5"),
				system: INGEST_WORKFLOW_OCR_SYSTEM_PROMPT,
				prompt: [
					{
						role: "user",
						content: [
							{ type: "text", text: INGEST_WORKFLOW_OCR_SYSTEM_PROMPT },
							{
								type: "image",
								image: event.payload.imageUrl,
							},
						],
					},
				],
				schema: z.object({
					tasks: z.array(
						z.object({
							id: z.string(),
							type: z.enum(["email", "text", "meeting"]),
							text: z.string(),
							completed: z.boolean().default(false),
							dependsOn: z
								.array(z.string())
								.optional()
								.describe(
									"IDs of tasks that must be completed before this task",
								),
							parents: z
								.array(z.string())
								.optional()
								.describe("IDs of explicitly mentioned parent tasks"),
						}),
					),
				}),
				schemaName: "TaskExtractionWithDependencies",
			});

			if (!result.object.tasks) {
				throw new Error("No tasks found");
			}

			console.log(`Done! Extracted ${result.object.tasks.length} tasks`);

			return result.object.tasks;
		});

		const { annotatedTasks, dag } = await step.do(
			"convert api response into a dag",
			async () => {
				console.log("Converting tasks to a DAG");

				const dag = new DAG<string>();
				dag.addNode("root");
				dag.addNode("sink");

				const taskIds = new Set(tasks.map((t) => t.id));

				for (const task of tasks) {
					dag.addNode(task.id);

					if (task.dependsOn) {
						for (const depId of task.dependsOn) {
							if (taskIds.has(depId)) {
								dag.addEdge(depId, task.id);
							}
						}
					}

					if (task.parents) {
						for (const parentId of task.parents) {
							if (taskIds.has(parentId)) {
								dag.addEdge(parentId, task.id);
							}
						}
					}
				}

				const roots = dag
					.getRoots()
					.filter((id) => id !== "root" && id !== "sink");
				for (const rootId of roots) {
					dag.addEdge("root", rootId);
				}

				const leaves = dag
					.getLeaves()
					.filter((id) => id !== "root" && id !== "sink");
				for (const leafId of leaves) {
					dag.addEdge(leafId, "sink");
				}

				const annotatedTasks = tasks.map((task) => ({
					...task,
					children: Array.from(dag.getNode(task.id)?.children || []).filter(
						(id) => id !== "sink",
					),
					parents: Array.from(dag.getNode(task.id)?.parents || []).filter(
						(id) => id !== "root",
					),
				}));

				console.log("Tasks converted to DAG");

				return { annotatedTasks, dag };
			},
		);

		console.log(annotatedTasks);
		console.log(dag.topologicalSort());

		return { dag: annotatedTasks };
	}
}
