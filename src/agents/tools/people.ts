import { tool } from "ai";
import { google } from "googleapis";
import { z } from "zod";

export function createPeopleTools(apiKey: string) {
	const people = google.people({
		version: "v1",
		auth: apiKey,
	});

	return {
		searchContacts: tool({
			description:
				"Search for contacts by name or email address to find their contact information",
			inputSchema: z.object({
				query: z
					.string()
					.describe("Name or email to search for (e.g., 'luke walsh')"),
				maxResults: z
					.number()
					.optional()
					.default(10)
					.describe("Maximum number of contacts to return"),
			}),
			execute: async ({ query, maxResults }) => {
				try {
					const response = await people.people.searchContacts({
						query,
						readMask: "names,emailAddresses,phoneNumbers",
						pageSize: maxResults,
					});

					if (!response.data.results || response.data.results.length === 0) {
						return {
							success: true,
							contacts: [],
							message: "No contacts found",
						};
					}

					const contacts = response.data.results.map((result) => {
						const person = result.person;
						const names = person?.names || [];
						const emails = person?.emailAddresses || [];
						const phones = person?.phoneNumbers || [];

						return {
							resourceName: person?.resourceName,
							displayName: names[0]?.displayName || "Unknown",
							givenName: names[0]?.givenName,
							familyName: names[0]?.familyName,
							emails: emails.map((e) => e.value),
							primaryEmail: emails.find((e) => e.metadata?.primary)?.value,
							phoneNumbers: phones.map((p) => p.value),
						};
					});

					return {
						success: true,
						contacts,
						count: contacts.length,
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error
								? error.message
								: "Failed to search contacts",
					};
				}
			},
		}),

		getContact: tool({
			description:
				"Get detailed information about a specific contact by their resource name",
			inputSchema: z.object({
				resourceName: z
					.string()
					.describe("Resource name of the contact (from searchContacts)"),
			}),
			execute: async ({ resourceName }) => {
				try {
					const response = await people.people.get({
						resourceName,
						personFields:
							"names,emailAddresses,phoneNumbers,addresses,organizations,birthdays",
					});

					const person = response.data;
					const names = person.names || [];
					const emails = person.emailAddresses || [];
					const phones = person.phoneNumbers || [];
					const addresses = person.addresses || [];
					const organizations = person.organizations || [];
					const birthdays = person.birthdays || [];

					return {
						success: true,
						contact: {
							resourceName: person.resourceName,
							displayName: names[0]?.displayName,
							givenName: names[0]?.givenName,
							familyName: names[0]?.familyName,
							emails: emails.map((e) => ({
								value: e.value,
								type: e.type,
								primary: e.metadata?.primary,
							})),
							phoneNumbers: phones.map((p) => ({
								value: p.value,
								type: p.type,
								primary: p.metadata?.primary,
							})),
							addresses: addresses.map((a) => ({
								formattedValue: a.formattedValue,
								type: a.type,
							})),
							organizations: organizations.map((o) => ({
								name: o.name,
								title: o.title,
								department: o.department,
							})),
							birthdays: birthdays.map((b) => ({
								date: b.date,
							})),
						},
					};
				} catch (error) {
					return {
						success: false,
						error:
							error instanceof Error ? error.message : "Failed to get contact",
					};
				}
			},
		}),
	};
}
