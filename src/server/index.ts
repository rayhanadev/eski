import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => c.text("ദ്ദി(˵ •̀ ᴗ - ˵ ) ✧"));

app.post("/upload", async (c) => {
	const authorization = c.req.header("Authorization");
	if (!authorization) {
		return c.text("Unauthorized", 401);
	}

	const token = authorization.split(" ")[1];
	if (!token || token !== c.env.API_SECRET_TOKEN) {
		return c.text("Invalid token", 400);
	}

	console.log("Received request");

	const blob = await c.req.blob();
	const buffer = await blob.arrayBuffer();
	let binary = "";
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;

	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}

	const base64 = btoa(binary);

	const instance = await c.env.INGEST_WORKFLOW.create({
		params: {
			image: {
				mediaType: blob.type,
				data: base64,
			},
		},
	});

	console.log("Created ingestion workflow:", instance.id);

	return c.json({ ok: true, metadata: { id: instance.id } });
});

app.get("/status/:id", async (c) => {
	const id = c.req.param("id");
	if (!id) {
		return c.text("Invalid ID", 400);
	}

	const instance = await c.env.INGEST_WORKFLOW.get(id);
	if (!instance) {
		return c.text("Not found", 404);
	}

	console.log(await instance.status());

	return c.json({ ok: true, metadata: { status: instance.status } });
});

export default app;
