import { Readable } from "node:stream";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  RequestMediaUploadUrlBody,
  RequestMediaUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage.js";

const router: IRouter = Router();
const storage = new ObjectStorageService();

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to upload marketplace media." });
    return;
  }

  const parsed = RequestMediaUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid media metadata." });
    return;
  }

  const { name, size, contentType } = parsed.data;
  if (
    size <= 0 ||
    size > 100 * 1024 * 1024 ||
    (!contentType.startsWith("image/") && !contentType.startsWith("video/"))
  ) {
    res.status(400).json({ error: "Invalid media metadata." });
    return;
  }

  try {
    const result = await storage.getUploadUrl();
    res.json(RequestMediaUploadUrlResponse.parse(result));
  } catch (error) {
    req.log.error({ err: error }, "Unable to create media upload URL");
    res.status(500).json({ error: "Unable to prepare media upload." });
  }
});

router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  const raw = req.params.path;
  const objectPath = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`;
  try {
    const file = await storage.getObject(objectPath);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", String(metadata.contentType ?? "application/octet-stream"));
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    Readable.from(file.createReadStream()).pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found." });
      return;
    }
    req.log.error({ err: error }, "Unable to serve media object");
    res.status(500).json({ error: "Unable to serve media object." });
  }
});

export default router;