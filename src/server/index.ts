import { Hono } from "hono";
import mime from "mime/lite";

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

	console.log("[server] received request");

	const blob = await c.req.blob();

	const date = new Date();
	const ext = mime.getExtension(blob.type);
	const key = `uploads/${date.toISOString()}.${ext}`;
	const object = await c.env.R2.put(key, blob);

	if (!object) {
		return c.text("Failed to upload file", 500);
	}

	const imageUrl = `${c.env.PUBLIC_R2_BUCKET_URL}/${key}`;

	const instance = await c.env.INGEST_WORKFLOW.create({
		params: { imageUrl },
	});

	console.log("[server] created ingestion workflow:", instance.id);

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
