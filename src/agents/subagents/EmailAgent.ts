import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "agents";
import { generateText, stepCountIs } from "ai";
import { EMAIL_AGENT_SYSTEM_PROMPT } from "../../utils/prompts";
import { createEmailTools } from "../tools/email";
import { createPeopleTools } from "../tools/people";

export type EmailAgentState = {
	orchestratorId: string;
	taskId: string;
	context: string;
	result?: string;
	completed?: boolean;
};

export class EmailAgent extends Agent<Env, EmailAgentState> {
	initialState: EmailAgentState = {
		orchestratorId: "",
		taskId: "",
		context: "",
		completed: false,
	};

	async onStart() {
		console.log(`[agent:email] starting agent: ${this.ctx.id}`);
	}

	async run({ orchestratorId, taskId, context }: EmailAgentState) {
		console.log(
			`[agent:email] processing task ${taskId}: ${context} for orchestrator: ${orchestratorId}`,
		);

		try {
			const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });
			const emailTools = createEmailTools(this.env.GOOGLE_API_KEY);
			const peopleTools = createPeopleTools(this.env.GOOGLE_API_KEY);

			const result = await generateText({
				model: openai("gpt-5"),
				system: EMAIL_AGENT_SYSTEM_PROMPT,
				prompt: context,
				tools: { ...emailTools, ...peopleTools },
				stopWhen: stepCountIs(15),
			});

			console.log("[agent:email] task completed successfully");
			console.log(`[agent:email] steps taken: ${result.steps?.length || 0}`);
			console.log(`[agent:email] result: ${result.text}`);

			this.setState({
				...this.state,
				result: result.text,
				completed: true,
			});

			const orchestratorStub = this.env.ORCHESTRATION_AGENT.get(
				this.env.ORCHESTRATION_AGENT.idFromString(orchestratorId),
			);
			await orchestratorStub.taskCompleted(taskId, {
				success: true,
				result: result.text,
				stepsCount: result.steps?.length || 0,
			});

			console.log(`[agent:email] reported completion to orchestrator`);

			return {
				success: true,
				result: result.text,
				stepsCount: result.steps?.length || 0,
			};
		} catch (error) {
			console.error("[agent:email] error processing request:", error);

			this.setState({
				...this.state,
				result: error instanceof Error ? error.message : "Unknown error",
				completed: false,
			});

			const orchestratorStub = this.env.ORCHESTRATION_AGENT.get(
				this.env.ORCHESTRATION_AGENT.idFromString(orchestratorId),
			);
			await orchestratorStub.taskFailed(
				taskId,
				error instanceof Error ? error.message : "Unknown error",
			);

			console.log(`[agent:email] reported failure to orchestrator`);

			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}
}
