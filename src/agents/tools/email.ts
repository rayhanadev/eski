import { tool } from "ai";
import { google } from "googleapis";
import { z } from "zod";

export function createEmailTools(apiKey: string) {
	const gmail = google.gmail({
		version: "v1",
		auth: apiKey,
	});

	return {
		searchEmails: tool({
			description:
				"Search for emails in the user's inbox using Gmail search queries (e.g., 'from:example@gmail.com', 'subject:meeting', 'is:unread', 'after:2024/01/01')",
			inputSchema: z.object({
				query: z
					.string()
					.describe(
						"Gmail search query (e.g., 'from:user@example.com subject:meeting')",
					),
				maxResults: z
					.number()
					.optional()
					.default(10)
					.describe("Maximum number of emails to return (default: 10)"),
			}),
			execute: async ({ query, maxResults }) => {
				try {
					const response = await gmail.users.messages.list({
						userId: "me",
						q: query,
						maxResults,
					});

					if (!response.data.messages) {
						return { success: true, emails: [], message: "No emails found" };
					}

					const emailDetails = await Promise.all(
						response.data.messages.map(async (message) => {
							const detail = await gmail.users.messages.get({
								userId: "me",
								id: message.id as string,
								format: "full",
							});

							const headers = detail.data.payload?.headers || [];
							const subject =
								headers.find((h) => h.name === "Subject")?.value ||
								"(No Subject)";
							const from =
								headers.find((h) => h.name === "From")?.value || "Unknown";
							const date =
								headers.find((h) => h.name === "Date")?.value || "Unknown";
							const to =
								headers.find((h) => h.name === "To")?.value || "Unknown";

							let body = "";
							if (detail.data.payload?.body?.data) {
								body = Buffer.from(
									detail.data.payload.body.data,
									"base64",
								).toString();
							} else if (detail.data.payload?.parts) {
								const textPart = detail.data.payload.parts.find(
									(part) => part.mimeType === "text/plain",
								);
								if (textPart?.body?.data) {
									body = Buffer.from(textPart.body.data, "base64").toString();
								}
							}

							return {
								id: detail.data.id,
								threadId: detail.data.threadId,
								subject,
								from,
								to,
								date,
								snippet: detail.data.snippet,
								body: body.substring(0, 1000),
							};
						}),
					);

					return {
						success: true,
						emails: emailDetails,
						count: emailDetails.length,
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error
								? error.message
								: "Failed to search emails",
					};
				}
			},
		}),

		readEmail: tool({
			description:
				"Read the full content of a specific email by its ID. Use searchEmails first to get email IDs.",
			inputSchema: z.object({
				emailId: z.string().describe("The ID of the email to read"),
			}),
			execute: async ({ emailId }) => {
				try {
					const response = await gmail.users.messages.get({
						userId: "me",
						id: emailId,
						format: "full",
					});

					const headers = response.data.payload?.headers || [];
					const subject =
						headers.find((h) => h.name === "Subject")?.value || "(No Subject)";
					const from =
						headers.find((h) => h.name === "From")?.value || "Unknown";
					const date =
						headers.find((h) => h.name === "Date")?.value || "Unknown";
					const to = headers.find((h) => h.name === "To")?.value || "Unknown";
					const cc = headers.find((h) => h.name === "Cc")?.value;

					let textBody = "";
					let htmlBody = "";

					const extractBody = (parts: any[]): void => {
						for (const part of parts) {
							if (part.mimeType === "text/plain" && part.body?.data) {
								textBody = Buffer.from(part.body.data, "base64").toString();
							} else if (part.mimeType === "text/html" && part.body?.data) {
								htmlBody = Buffer.from(part.body.data, "base64").toString();
							} else if (part.parts) {
								extractBody(part.parts);
							}
						}
					};

					if (response.data.payload?.body?.data) {
						textBody = Buffer.from(
							response.data.payload.body.data,
							"base64",
						).toString();
					} else if (response.data.payload?.parts) {
						extractBody(response.data.payload.parts);
					}

					return {
						success: true,
						email: {
							id: response.data.id,
							threadId: response.data.threadId,
							subject,
							from,
							to,
							cc,
							date,
							snippet: response.data.snippet,
							textBody,
							htmlBody,
							labels: response.data.labelIds,
						},
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error ? error.message : "Failed to read email",
					};
				}
			},
		}),

		draftEmail: tool({
			description:
				"Create a draft email that can be reviewed before sending. The draft is saved to the user's Gmail drafts folder.",
			inputSchema: z.object({
				to: z.string().describe("Recipient email address"),
				subject: z.string().describe("Email subject"),
				body: z.string().describe("Email body content"),
				cc: z
					.string()
					.optional()
					.describe("CC email addresses (comma-separated)"),
				bcc: z
					.string()
					.optional()
					.describe("BCC email addresses (comma-separated)"),
			}),
			execute: async ({ to, subject, body, cc, bcc }) => {
				try {
					const email = [
						`To: ${to}`,
						cc ? `Cc: ${cc}` : "",
						bcc ? `Bcc: ${bcc}` : "",
						`Subject: ${subject}`,
						"",
						body,
					]
						.filter(Boolean)
						.join("\n");

					const encodedEmail = Buffer.from(email)
						.toString("base64")
						.replace(/\+/g, "-")
						.replace(/\//g, "_")
						.replace(/=+$/, "");

					const response = await gmail.users.drafts.create({
						userId: "me",
						requestBody: {
							message: {
								raw: encodedEmail,
							},
						},
					});

					return {
						success: true,
						draftId: response.data.id,
						message: "Draft created successfully",
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error ? error.message : "Failed to create draft",
					};
				}
			},
		}),

		sendEmail: tool({
			description:
				"Send an email immediately. Use this to send new emails or reply to existing threads.",
			inputSchema: z.object({
				to: z.string().describe("Recipient email address"),
				subject: z.string().describe("Email subject"),
				body: z.string().describe("Email body content"),
				cc: z
					.string()
					.optional()
					.describe("CC email addresses (comma-separated)"),
				bcc: z
					.string()
					.optional()
					.describe("BCC email addresses (comma-separated)"),
				threadId: z
					.string()
					.optional()
					.describe("Thread ID to reply to (optional, for replies)"),
			}),
			execute: async ({ to, subject, body, cc, bcc, threadId }) => {
				try {
					const email = [
						`To: ${to}`,
						cc ? `Cc: ${cc}` : "",
						bcc ? `Bcc: ${bcc}` : "",
						`Subject: ${subject}`,
						"",
						body,
					]
						.filter(Boolean)
						.join("\n");

					const encodedEmail = Buffer.from(email)
						.toString("base64")
						.replace(/\+/g, "-")
						.replace(/\//g, "_")
						.replace(/=+$/, "");

					const response = await gmail.users.messages.send({
						userId: "me",
						requestBody: {
							raw: encodedEmail,
							threadId,
						},
					});

					return {
						success: true,
						messageId: response.data.id,
						threadId: response.data.threadId,
						message: "Email sent successfully",
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error ? error.message : "Failed to send email",
					};
				}
			},
		}),
	};
}
