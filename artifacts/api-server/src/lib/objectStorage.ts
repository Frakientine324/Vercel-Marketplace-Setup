import { randomUUID } from "node:crypto";
import { File, Storage } from "@google-cloud/storage";

const SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
  }
}

export class ObjectStorageService {
  private getPrivateDir() {
    const dir = process.env.PRIVATE_OBJECT_DIR;
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
    return dir.replace(/\/$/, "");
  }

  async getUploadUrl() {
    const objectName = `${this.getPrivateDir()}/uploads/${randomUUID()}`;
    const { bucketName, fileName } = parseStoragePath(objectName);
    const response = await fetch(`${SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: fileName,
        method: "PUT",
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Unable to create upload URL (${response.status}).`);
    const body = (await response.json()) as { signed_url?: string };
    if (!body.signed_url) throw new Error("Storage did not return an upload URL.");
    return {
      uploadURL: body.signed_url,
      objectPath: `/objects/${fileName.slice(this.getPrivateDir().length + 1)}`,
    };
  }

  async getObject(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const fullPath = `${this.getPrivateDir()}/${objectPath.slice("/objects/".length)}`;
    const { bucketName, fileName } = parseStoragePath(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(fileName);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError();
    return file;
  }
}

function parseStoragePath(path: string) {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  const slash = normalized.indexOf("/");
  if (slash < 1) throw new Error("Invalid object storage path.");
  return { bucketName: normalized.slice(0, slash), fileName: normalized.slice(slash + 1) };
}