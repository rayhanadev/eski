import { Agent } from "agents";
import { DAG, type JSONGraph } from "../utils/dag";
import type { TaskMetadata } from "../workflows/IngestWorkflow";

export type TaskState = {
	status: "idle" | "ready" | "running" | "completed" | "failed";
	result?: any;
	error?: string;
	subagentId?: string;
	startedAt?: number;
	completedAt?: number;
};

export type OrchestrationAgentState = {
	state: "uninitialized" | "running" | "completed" | "failed";
	graph: JSONGraph<string, TaskMetadata>;
	taskStates: Record<string, TaskState>;
};

export class OrchestrationAgent extends Agent<Env, OrchestrationAgentState> {
	initialState: OrchestrationAgentState = {
		state: "uninitialized",
		graph: { nodes: [], edges: [] },
		taskStates: {},
	};

	async onStart() {
		console.log(
			`[agent:orchestration] starting agent: ${this.ctx.id.toString()}`,
		);
	}

	async handoff(graph: JSONGraph<string, TaskMetadata>) {
		console.log("[agent:orchestration] received DAG handoff");
		const dag = DAG.fromJSON(graph);

		const root = dag.getNode("root");
		const sink = dag.getNode("sink");

		if (!root || !sink) {
			throw new Error("Invalid DAG: missing root or sink");
		}

		const taskStates: Record<string, TaskState> = {};
		for (const node of graph.nodes) {
			if (node.id === "root") {
				taskStates[node.id] = { status: "completed", completedAt: Date.now() };
			} else if (node.id === "sink") {
				taskStates[node.id] = { status: "idle" };
			} else {
				taskStates[node.id] = { status: "idle" };
			}
		}

		this.setState({
			graph,
			state: "running",
			taskStates,
		});

		console.log(
			`[agent:orchestration] initialized ${Object.keys(taskStates).length} tasks`,
		);
		await this.executeReadyTasks();
	}

	async taskCompleted(taskId: string, result: any) {
		console.log(`[agent:orchestration] task completed: ${taskId}`);
		const { taskStates } = this.state;

		if (!taskStates[taskId]) {
			console.error(`[agent:orchestration] unknown task: ${taskId}`);
			return;
		}

		taskStates[taskId] = {
			...taskStates[taskId],
			status: "completed",
			result,
			completedAt: Date.now(),
		};

		this.setState({ ...this.state, taskStates });

		if (taskId === "sink") {
			console.log(
				"[agent:orchestration] all tasks completed. workflow finished.",
			);
			this.setState({ ...this.state, state: "completed" });
			await this.onWorkflowComplete();
			return;
		}

		await this.executeReadyTasks();
	}

	async taskFailed(taskId: string, error: string) {
		console.error(`[agent:orchestration] task failed: ${taskId}`, error);
		const { taskStates } = this.state;

		if (!taskStates[taskId]) {
			console.error(`[agent:orchestration] unknown task: ${taskId}`);
			return;
		}

		taskStates[taskId] = {
			...taskStates[taskId],
			status: "failed",
			error,
			completedAt: Date.now(),
		};

		this.setState({ ...this.state, taskStates });
	}

	private async executeReadyTasks() {
		const { graph, taskStates } = this.state;
		const dag = DAG.fromJSON(graph);

		const readyTasks: string[] = [];
		for (const [taskId, taskState] of Object.entries(taskStates)) {
			if (
				taskState.status === "idle" &&
				this.isTaskReady(taskId, dag, taskStates)
			) {
				readyTasks.push(taskId);
			}
		}

		console.log(
			`[agent:orchestration] found ${readyTasks.length} ready tasks: ${readyTasks.join(", ")}`,
		);

		for (const taskId of readyTasks) {
			await this.executeTask(taskId);
		}
	}

	private async executeTask(taskId: string) {
		const { graph, taskStates } = this.state;
		const dag = DAG.fromJSON(graph);
		const node = dag.getNode(taskId);

		if (!node) {
			console.error(`[agent:orchestration] task not found: ${taskId}`);
			return;
		}

		if (node.id === "sink") {
			console.log("[agent:orchestration] all tasks completed, marking sink");
			await this.taskCompleted("sink", { completed: true });
			return;
		}

		const subagentId = (() => {
			switch (node.metadata.type) {
				case "email":
					return this.env.EMAIL_AGENT.newUniqueId();
				case "calendar":
					return this.env.CALENDAR_AGENT.newUniqueId();
				default:
					throw new Error(`Unknown task type: ${node.metadata.type}`);
			}
		})();

		taskStates[taskId] = {
			...taskStates[taskId],
			status: "running",
			subagentId: subagentId.toString(),
			startedAt: Date.now(),
		};

		this.setState({ ...this.state, taskStates });

		console.log(
			`[agent:orchestration] executing task: ${taskId} (${node.metadata.type}) with subagent: ${subagentId.toString()}`,
		);

		switch (node.metadata.type) {
			case "email": {
				const subagent = this.env.EMAIL_AGENT.get(subagentId);
				subagent.run({
					orchestratorId: this.ctx.id.toString(),
					taskId,
					context: node.metadata.text,
				});
				break;
			}
			case "calendar": {
				const subagent = this.env.CALENDAR_AGENT.get(subagentId);
				subagent.run({
					orchestratorId: this.ctx.id.toString(),
					taskId,
					context: node.metadata.text,
				});
				break;
			}
		}
	}

	private isTaskReady(
		taskId: string,
		dag: DAG<string, TaskMetadata>,
		taskStates: Record<string, TaskState>,
	): boolean {
		const node = dag.getNode(taskId);
		if (!node) return false;

		const parents = Array.from(node.parents.values());

		if (taskId === "sink") {
			const allLeafTasksCompleted = parents.every((parentId) => {
				const parentState = taskStates[parentId];
				return parentState && parentState.status === "completed";
			});

			if (allLeafTasksCompleted && parents.length > 0) {
				console.log(
					`[agent:orchestration] all ${parents.length} leaf tasks completed. sink is ready.`,
				);
			}

			return allLeafTasksCompleted;
		}

		return parents.every((parentId) => {
			const parentState = taskStates[parentId];
			return parentState && parentState.status === "completed";
		});
	}

	private async onWorkflowComplete() {
		console.log("[agent:orchestration] executing post-completion tasks...");
		const { taskStates, graph } = this.state;
		const dag = DAG.fromJSON(graph);

		const completedTasks = Object.entries(taskStates)
			.filter(
				([id, state]) =>
					state.status === "completed" && id !== "root" && id !== "sink",
			)
			.map(([id, state]) => {
				const node = dag.getNode(id);
				return {
					taskId: id,
					type: node?.metadata.type,
					text: node?.metadata.text,
					result: state.result,
					duration:
						state.completedAt && state.startedAt
							? state.completedAt - state.startedAt
							: 0,
				};
			});

		const failedTasks = Object.entries(taskStates)
			.filter(([_id, state]) => state.status === "failed")
			.map(([id, state]) => {
				const node = dag.getNode(id);
				return {
					taskId: id,
					type: node?.metadata.type,
					text: node?.metadata.text,
					error: state.error,
				};
			});

		console.log(
			`[agent:orchestration] summary: ${completedTasks.length} completed, ${failedTasks.length} failed`,
		);

		await this.sendCompletionNotification(completedTasks, failedTasks);

		console.log(
			"[agent:orchestration] workflow complete. all results saved to state.",
		);
	}

	private async sendCompletionNotification(
		completedTasks: Array<{
			taskId: string;
			type?: string;
			text?: string;
			result: any;
			duration: number;
		}>,
		failedTasks: Array<{
			taskId: string;
			type?: string;
			text?: string;
			error?: string;
		}>,
	) {
		console.log("[agent:orchestration] sending completion notification...");

		const totalDuration = completedTasks.reduce(
			(sum, task) => sum + task.duration,
			0,
		);
		const avgDuration =
			completedTasks.length > 0 ? totalDuration / completedTasks.length : 0;

		const summary = {
			completedTasks: completedTasks.length,
			failedTasks: failedTasks.length,
			averageDuration: Math.round(avgDuration / 1000),
			status: failedTasks.length === 0 ? "success" : "completed_with_errors",
		};

		console.log(summary);
	}
}
