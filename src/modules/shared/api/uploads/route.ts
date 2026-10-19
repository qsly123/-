import path from "path";
import { readFile, stat } from "fs/promises";
import { NextResponse } from "next/server";
import {
  getPreferredUploadsRoot,
  resolveExistingUploadFilePath,
} from "@/modules/shared/services/upload-storage";

export const runtime = "nodejs";
const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

function badRequest() {
  return new NextResponse("Bad Request", {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function notFound() {
  return new NextResponse("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function getContentType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

async function resolveUploadPath(segments: string[]) {
  if (!segments.length) {
    return null;
  }

  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      return null;
    }
    if (segment === ".bak") {
      return null;
    }
    if (segment.includes("/") || segment.includes("\\")) {
      return null;
    }
  }

  const existingPath = await resolveExistingUploadFilePath(segments);
  if (existingPath) {
    return existingPath;
  }

  const uploadsRoot = await getPreferredUploadsRoot();
  const filePath = path.resolve(uploadsRoot, ...segments);
  const rootWithSlash = `${uploadsRoot}${path.sep}`;
  if (filePath !== uploadsRoot && !filePath.startsWith(rootWithSlash)) {
    return null;
  }

  return filePath;
}

async function serveUpload(paramsPromise: Promise<{ segments: string[] }>, method: "GET" | "HEAD") {
  const { segments } = await paramsPromise;
  const filePath = await resolveUploadPath(Array.isArray(segments) ? segments : []);
  if (!filePath) {
    return badRequest();
  }

  try {
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) {
      return notFound();
    }

    const headers = new Headers({
      "Content-Type": getContentType(filePath),
      "Content-Length": String(fileInfo.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    });

    if (method === "HEAD") {
      return new NextResponse(null, { status: 200, headers });
    }

    const buffer = await readFile(filePath);
    return new NextResponse(buffer, { status: 200, headers });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return notFound();
    }
    return new NextResponse("Internal Server Error", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ segments: string[] }> }) {
  return serveUpload(params, "GET");
}

export async function HEAD(_request: Request, { params }: { params: Promise<{ segments: string[] }> }) {
  return serveUpload(params, "HEAD");
}
