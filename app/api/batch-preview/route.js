import { NextResponse } from "next/server";
import { scanBatchRoot } from "../../../lib/video.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { rootPath, orderedProjects } = await request.json();
    if (!rootPath) return NextResponse.json({ error: "请填写总文件夹路径" }, { status: 400 });
    return NextResponse.json(await scanBatchRoot(rootPath, orderedProjects));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
