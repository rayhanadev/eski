import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "agents";
import { generateText, stepCountIs } from "ai";
import { CALENDAR_AGENT_SYSTEM_PROMPT } from "../../utils/prompts";
import { createCalendarTools } from "../tools/calendar";
import { createPeopleTools } from "../tools/people";

export type CalendarAgentState = {
	orchestratorId: string;
	taskId: string;
	context: string;
	result?: string;
	completed?: boolean;
};

export class CalendarAgent extends Agent<Env, CalendarAgentState> {
	initialState: CalendarAgentState = {
		orchestratorId: "",
		taskId: "",
		context: "",
		completed: false,
	};

	async onStart() {
		console.log(`[agent:calendar] starting agent: ${this.ctx.id}`);
	}

	async run({ orchestratorId, taskId, context }: CalendarAgentState) {
		console.log(
			`[agent:calendar] processing task ${taskId}: ${context} for orchestrator: ${orchestratorId}`,
		);

		try {
			const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });
			const calendarTools = createCalendarTools(this.env.GOOGLE_API_KEY);
			const peopleTools = createPeopleTools(this.env.GOOGLE_API_KEY);

			const result = await generateText({
				model: openai("gpt-5"),
				system: CALENDAR_AGENT_SYSTEM_PROMPT,
				prompt: context,
				tools: { ...calendarTools, ...peopleTools },
				stopWhen: stepCountIs(15),
			});

			console.log("[agent:calendar] task completed successfully");
			console.log(`[agent:calendar] steps taken: ${result.steps?.length || 0}`);
			console.log(`[agent:calendar] result: ${result.text}`);

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

			console.log(`[agent:calendar] reported completion to orchestrator`);

			return {
				success: true,
				result: result.text,
				stepsCount: result.steps?.length || 0,
			};
		} catch (error) {
			console.error("[agent:calendar] error processing request:", error);

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

			console.log(`[agent:calendar] reported failure to orchestrator`);

			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}
}
