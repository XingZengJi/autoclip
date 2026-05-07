import { NextResponse } from "next/server";
import { createJob, exportBatchProjectJob } from "../../../lib/video.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { rootPath, folderPath, orderedPaths } = await request.json();
    if (!rootPath) return NextResponse.json({ error: "请填写总文件夹路径" }, { status: 400 });
    if (!folderPath) return NextResponse.json({ error: "请提供当前子文件夹路径" }, { status: 400 });
    const job = createJob("batch-current");
    exportBatchProjectJob(job, rootPath, folderPath, orderedPaths);
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
