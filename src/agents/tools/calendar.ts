import { tool } from "ai";
import { google } from "googleapis";
import { z } from "zod";

export function createCalendarTools(apiKey: string) {
	const calendar = google.calendar({
		version: "v3",
		auth: apiKey,
	});

	return {
		searchEvents: tool({
			description:
				"Search for calendar events within a time range. Use this to check availability or find existing meetings.",
			inputSchema: z.object({
				timeMin: z
					.string()
					.optional()
					.describe(
						"Start time in ISO 8601 format (e.g., '2024-01-20T09:00:00Z')",
					),
				timeMax: z
					.string()
					.optional()
					.describe(
						"End time in ISO 8601 format (e.g., '2024-01-20T17:00:00Z')",
					),
				query: z
					.string()
					.optional()
					.describe("Search query to filter events by title or description"),
				maxResults: z
					.number()
					.optional()
					.default(10)
					.describe("Maximum number of events to return"),
			}),
			execute: async ({ timeMin, timeMax, query, maxResults }) => {
				try {
					const response = await calendar.events.list({
						calendarId: "primary",
						timeMin,
						timeMax,
						q: query,
						maxResults,
						singleEvents: true,
						orderBy: "startTime",
					});

					if (!response.data.items || response.data.items.length === 0) {
						return {
							success: true,
							events: [],
							message: "No events found in the specified time range",
						};
					}

					const events = response.data.items.map((event) => ({
						id: event.id,
						summary: event.summary,
						description: event.description,
						start: event.start?.dateTime || event.start?.date,
						end: event.end?.dateTime || event.end?.date,
						attendees: event.attendees?.map((a) => ({
							email: a.email,
							displayName: a.displayName,
							responseStatus: a.responseStatus,
						})),
						location: event.location,
						status: event.status,
						htmlLink: event.htmlLink,
					}));

					return {
						success: true,
						events,
						count: events.length,
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error
								? error.message
								: "Failed to search events",
					};
				}
			},
		}),

		getEvent: tool({
			description:
				"Get details of a specific calendar event by its ID. Use searchEvents first to get event IDs.",
			inputSchema: z.object({
				eventId: z.string().describe("The ID of the calendar event"),
			}),
			execute: async ({ eventId }) => {
				try {
					const response = await calendar.events.get({
						calendarId: "primary",
						eventId,
					});

					const event = response.data;

					return {
						success: true,
						event: {
							id: event.id,
							summary: event.summary,
							description: event.description,
							start: event.start?.dateTime || event.start?.date,
							end: event.end?.dateTime || event.end?.date,
							attendees: event.attendees?.map((a) => ({
								email: a.email,
								displayName: a.displayName,
								responseStatus: a.responseStatus,
								organizer: a.organizer,
								optional: a.optional,
							})),
							location: event.location,
							status: event.status,
							htmlLink: event.htmlLink,
							creator: event.creator,
							organizer: event.organizer,
							recurringEventId: event.recurringEventId,
							reminders: event.reminders,
						},
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error ? error.message : "Failed to get event",
					};
				}
			},
		}),

		createEvent: tool({
			description:
				"Create a new calendar event. Use this to schedule meetings or appointments.",
			inputSchema: z.object({
				summary: z.string().describe("Event title/summary"),
				description: z.string().optional().describe("Event description"),
				startTime: z
					.string()
					.describe(
						"Start time in ISO 8601 format (e.g., '2024-01-20T15:00:00Z')",
					),
				endTime: z
					.string()
					.describe(
						"End time in ISO 8601 format (e.g., '2024-01-20T16:00:00Z')",
					),
				attendees: z
					.array(z.string())
					.optional()
					.describe("Email addresses of attendees"),
				location: z
					.string()
					.optional()
					.describe("Meeting location or video link"),
				sendUpdates: z
					.enum(["all", "externalOnly", "none"])
					.optional()
					.default("all")
					.describe("Whether to send email notifications to attendees"),
			}),
			execute: async ({
				summary,
				description,
				startTime,
				endTime,
				attendees,
				location,
				sendUpdates,
			}) => {
				try {
					const response = await calendar.events.insert({
						calendarId: "primary",
						sendUpdates,
						requestBody: {
							summary,
							description,
							start: {
								dateTime: startTime,
							},
							end: {
								dateTime: endTime,
							},
							attendees: attendees?.map((email) => ({ email })),
							location,
							reminders: {
								useDefault: true,
							},
						},
					});

					return {
						success: true,
						event: {
							id: response.data.id,
							summary: response.data.summary,
							start: response.data.start?.dateTime,
							end: response.data.end?.dateTime,
							htmlLink: response.data.htmlLink,
						},
						message: "Event created successfully",
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error ? error.message : "Failed to create event",
					};
				}
			},
		}),

		updateEvent: tool({
			description:
				"Update an existing calendar event. Use this to modify event details, time, or attendees.",
			inputSchema: z.object({
				eventId: z.string().describe("The ID of the event to update"),
				summary: z.string().optional().describe("New event title/summary"),
				description: z.string().optional().describe("New event description"),
				startTime: z
					.string()
					.optional()
					.describe("New start time in ISO 8601 format"),
				endTime: z
					.string()
					.optional()
					.describe("New end time in ISO 8601 format"),
				attendees: z
					.array(z.string())
					.optional()
					.describe("Email addresses of attendees"),
				location: z.string().optional().describe("New meeting location"),
				sendUpdates: z
					.enum(["all", "externalOnly", "none"])
					.optional()
					.default("all")
					.describe("Whether to send email notifications to attendees"),
			}),
			execute: async ({
				eventId,
				summary,
				description,
				startTime,
				endTime,
				attendees,
				location,
				sendUpdates,
			}) => {
				try {
					const existing = await calendar.events.get({
						calendarId: "primary",
						eventId,
					});

					const response = await calendar.events.update({
						calendarId: "primary",
						eventId,
						sendUpdates,
						requestBody: {
							...existing.data,
							summary: summary || existing.data.summary,
							description: description || existing.data.description,
							start: startTime ? { dateTime: startTime } : existing.data.start,
							end: endTime ? { dateTime: endTime } : existing.data.end,
							attendees: attendees
								? attendees.map((email) => ({ email }))
								: existing.data.attendees,
							location: location || existing.data.location,
						},
					});

					return {
						success: true,
						event: {
							id: response.data.id,
							summary: response.data.summary,
							start: response.data.start?.dateTime,
							end: response.data.end?.dateTime,
							htmlLink: response.data.htmlLink,
						},
						message: "Event updated successfully",
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error ? error.message : "Failed to update event",
					};
				}
			},
		}),

		deleteEvent: tool({
			description:
				"Delete a calendar event. Use this to cancel meetings or remove events.",
			inputSchema: z.object({
				eventId: z.string().describe("The ID of the event to delete"),
				sendUpdates: z
					.enum(["all", "externalOnly", "none"])
					.optional()
					.default("all")
					.describe("Whether to send cancellation notifications to attendees"),
			}),
			execute: async ({ eventId, sendUpdates }) => {
				try {
					await calendar.events.delete({
						calendarId: "primary",
						eventId,
						sendUpdates,
					});

					return {
						success: true,
						message: "Event deleted successfully",
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error ? error.message : "Failed to delete event",
					};
				}
			},
		}),

		checkAvailability: tool({
			description:
				"Check free/busy status for multiple calendars or people within a time range. Useful for finding available meeting times.",
			inputSchema: z.object({
				startTime: z
					.string()
					.describe(
						"Start time in ISO 8601 format (e.g., '2024-01-20T09:00:00Z')",
					),
				endTime: z
					.string()
					.describe(
						"End time in ISO 8601 format (e.g., '2024-01-20T17:00:00Z')",
					),
				emails: z
					.array(z.string())
					.optional()
					.default(["primary"])
					.describe("Email addresses or calendar IDs to check"),
			}),
			execute: async ({ startTime, endTime, emails }) => {
				try {
					const response = await calendar.freebusy.query({
						requestBody: {
							timeMin: startTime,
							timeMax: endTime,
							items: emails.map((email) => ({ id: email })),
						},
					});

					const calendars = response.data.calendars || {};
					const availability = Object.entries(calendars).map(([id, data]) => ({
						calendar: id,
						busy: data.busy?.map((b) => ({
							start: b.start,
							end: b.end,
						})),
					}));

					return {
						success: true,
						availability,
						timeRange: {
							start: startTime,
							end: endTime,
						},
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error
								? error.message
								: "Failed to check availability",
					};
				}
			},
		}),
	};
}
