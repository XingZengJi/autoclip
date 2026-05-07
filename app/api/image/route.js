import { createReadStream } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { SUPPORTED_EXTENSIONS, contentTypeForImage, fileExists } from "../../../lib/video.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const imagePath = url.searchParams.get("path");
  if (!imagePath) return new NextResponse("缺少图片路径", { status: 400 });

  const absolutePath = path.resolve(imagePath);
  if (!SUPPORTED_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
    return new NextResponse("不支持的图片格式", { status: 400 });
  }
  if (!(await fileExists(absolutePath))) return new NextResponse("图片不存在", { status: 404 });

  const stream = createReadStream(absolutePath);
  return new NextResponse(stream, {
    headers: {
      "Content-Type": contentTypeForImage(absolutePath),
      "Cache-Control": "no-store"
    }
  });
}
