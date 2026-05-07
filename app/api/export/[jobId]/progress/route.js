import { NextResponse } from "next/server";
import { jobs } from "../../../../../lib/video.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { jobId } = await params;
  const job = jobs.get(jobId);
  if (!job) return NextResponse.json({ error: "没有找到这个导出任务" }, { status: 404 });
  return NextResponse.json(job);
}
