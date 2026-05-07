import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const OUTPUT_WIDTH = 2160;
export const OUTPUT_HEIGHT = 3840;
export const FPS = 30;
export const IMAGE_SECONDS = 3;
export const TRANSITION_SECONDS = 0.5;
export const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
export const jobs = new Map();

export function contentTypeForImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp"
  }[ext] || "application/octet-stream";
}

export async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  const hash = createHash("md5");
  await new Promise((resolve, reject) => {
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}\n${stderr || stdout}`));
    });
  });
}

async function probeImage(filePath) {
  const { stdout } = await runProcess("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json",
    filePath
  ]);
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error(`无法读取图片尺寸：${filePath}`);
  return { width: stream.width, height: stream.height };
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function safeVideoBaseName(name) {
  const cleaned = String(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return cleaned || "未命名视频";
}

function projectIdFor(folderPath) {
  return createHash("sha1").update(path.resolve(folderPath)).digest("hex").slice(0, 12);
}

async function scanFolder(folderPath) {
  const absoluteFolder = path.resolve(folderPath);
  const folderStat = await stat(absoluteFolder);
  if (!folderStat.isDirectory()) throw new Error("路径不是文件夹");

  const entries = await readdir(absoluteFolder, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(absoluteFolder, entry.name))
    .filter((file) => SUPPORTED_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  const images = [];
  for (const file of files) {
    const [info, md5] = await Promise.all([probeImage(file), hashFile(file)]);
    images.push({
      id: createHash("sha1").update(file).digest("hex").slice(0, 12),
      name: path.basename(file),
      path: file,
      width: info.width,
      height: info.height,
      aspect: Number((info.width / info.height).toFixed(4)),
      md5
    });
  }
  return { folderPath: absoluteFolder, images };
}

function applyImageOrder(images, orderedPaths = []) {
  if (!Array.isArray(orderedPaths) || !orderedPaths.length) return images;
  const byPath = new Map(images.map((image) => [image.path, image]));
  const orderedImages = [];
  const seen = new Set();
  for (const itemPath of orderedPaths) {
    const absolutePath = path.resolve(itemPath);
    const image = byPath.get(absolutePath);
    if (!image || seen.has(absolutePath)) continue;
    orderedImages.push(image);
    seen.add(absolutePath);
  }
  for (const image of images) {
    if (!seen.has(image.path)) orderedImages.push(image);
  }
  return orderedImages;
}

export async function scanFolderWithOrder(folderPath, orderedPaths = []) {
  const result = await scanFolder(folderPath);
  return { ...result, images: applyImageOrder(result.images, orderedPaths) };
}

function seededNumber(seed) {
  const hash = createHash("sha256").update(seed).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}

function createMotionPlan(image, index) {
  const directions = [
    { label: "左上到右下", startX: 0.08, startY: 0.08, endX: 0.92, endY: 0.92 },
    { label: "右上到左下", startX: 0.92, startY: 0.08, endX: 0.08, endY: 0.92 },
    { label: "左到右", startX: 0.06, startY: 0.5, endX: 0.94, endY: 0.5 },
    { label: "右到左", startX: 0.94, startY: 0.5, endX: 0.06, endY: 0.5 },
    { label: "下到上", startX: 0.5, startY: 0.9, endX: 0.5, endY: 0.1 }
  ];
  const pick = Math.floor(seededNumber(`${image.path}:${index}`) * directions.length) % directions.length;
  return { ...directions[pick], zoom: 1.12, duration: IMAGE_SECONDS, fps: FPS };
}

export function buildPreviewPlan(images) {
  return images.map((image, index) => ({
    ...image,
    outputWidth: OUTPUT_WIDTH,
    outputHeight: OUTPUT_HEIGHT,
    targetAspect: "9:16",
    processedFileName: `${String(index + 1).padStart(3, "0")}-${sanitizeFileName(path.parse(image.name).name)}.jpg`,
    motion: createMotionPlan(image, index),
    transitionAfterSeconds: index < images.length - 1 ? TRANSITION_SECONDS : 0
  }));
}

function makeProject(folderPath, images, index = 0) {
  const absoluteFolder = path.resolve(folderPath);
  return {
    id: projectIdFor(absoluteFolder),
    name: path.basename(absoluteFolder),
    folderPath: absoluteFolder,
    index,
    outputFileName: `${safeVideoBaseName(path.basename(absoluteFolder))}.mp4`,
    images,
    plan: buildPreviewPlan(images)
  };
}

export async function scanBatchRoot(rootPath, orderedProjects = []) {
  const absoluteRoot = path.resolve(rootPath);
  const rootStat = await stat(absoluteRoot);
  if (!rootStat.isDirectory()) throw new Error("路径不是文件夹");

  const orderByProject = new Map(
    Array.isArray(orderedProjects)
      ? orderedProjects.map((project) => [path.resolve(project.folderPath || ""), project.orderedPaths || []])
      : []
  );

  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const childFolders = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => path.join(absoluteRoot, entry.name))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  const projects = [];
  for (const childFolder of childFolders) {
    const orderedPaths = orderByProject.get(path.resolve(childFolder)) || [];
    const { images } = await scanFolderWithOrder(childFolder, orderedPaths);
    if (images.length) projects.push(makeProject(childFolder, images, projects.length));
  }

  if (!projects.length) {
    const orderedPaths = orderByProject.get(absoluteRoot) || [];
    const { images } = await scanFolderWithOrder(absoluteRoot, orderedPaths);
    if (images.length) projects.push(makeProject(absoluteRoot, images, 0));
  }

  return {
    rootPath: absoluteRoot,
    outputDir: path.join(absoluteRoot, "auto-cut-batch-output"),
    projects,
    totalImages: projects.reduce((sum, project) => sum + project.images.length, 0),
    settings: defaultSettings()
  };
}

function progress(job, percent, step, extra = {}) {
  Object.assign(job, { percent, step, updatedAt: new Date().toISOString(), ...extra });
}

async function createProcessedImage(input, output, comment) {
  await runProcess("ffmpeg", [
    "-y", "-i", input,
    "-vf", `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`,
    "-frames:v", "1",
    "-q:v", "2",
    "-metadata", `comment=${comment}`,
    output
  ]);
}

function motionFilter(plan) {
  const scaledW = Math.round(OUTPUT_WIDTH * plan.motion.zoom);
  const scaledH = Math.round(OUTPUT_HEIGHT * plan.motion.zoom);
  const maxX = scaledW - OUTPUT_WIDTH;
  const maxY = scaledH - OUTPUT_HEIGHT;
  const startX = Math.round(maxX * plan.motion.startX);
  const endX = Math.round(maxX * plan.motion.endX);
  const startY = Math.round(maxY * plan.motion.startY);
  const endY = Math.round(maxY * plan.motion.endY);
  const frames = IMAGE_SECONDS * FPS;
  return [
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase`,
    `crop=${scaledW}:${scaledH}`,
    `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:x='${startX}+(${endX - startX})*n/${frames - 1}':y='${startY}+(${endY - startY})*n/${frames - 1}'`,
    `fps=${FPS}`,
    "format=yuv420p"
  ].join(",");
}

async function createSegment(input, output, plan) {
  await runProcess("ffmpeg", [
    "-y", "-loop", "1", "-t", String(IMAGE_SECONDS), "-i", input,
    "-vf", motionFilter(plan),
    "-r", String(FPS),
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    output
  ]);
}

async function concatSegments(segmentFiles, outputFile, workDir) {
  if (segmentFiles.length === 1) {
    await runProcess("ffmpeg", ["-y", "-i", segmentFiles[0], "-c", "copy", outputFile]);
    return;
  }
  const inputArgs = segmentFiles.flatMap((file) => ["-i", file]);
  let filter = "";
  let last = "[0:v]";
  let offset = IMAGE_SECONDS - TRANSITION_SECONDS;
  for (let i = 1; i < segmentFiles.length; i += 1) {
    const out = i === segmentFiles.length - 1 ? "[v]" : `[x${i}]`;
    filter += `${last}[${i}:v]xfade=transition=fade:duration=${TRANSITION_SECONDS}:offset=${offset.toFixed(3)}${out};`;
    last = out;
    offset += IMAGE_SECONDS - TRANSITION_SECONDS;
  }
  await runProcess("ffmpeg", [
    "-y", ...inputArgs,
    "-filter_complex", filter.replace(/;$/, ""),
    "-map", "[v]",
    "-r", String(FPS),
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    outputFile
  ], { cwd: workDir });
}

async function uniqueOutputPath(outputDir, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(outputDir, fileName);
  let index = 2;
  while (await fileExists(candidate)) {
    candidate = path.join(outputDir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

async function renderVideoFromImages({ job, images, outputDir, outputFileName, workName, progressStart = 0, progressEnd = 100, progressLabel = "" }) {
  if (!images.length) throw new Error("没有可导出的图片");
  const plan = buildPreviewPlan(images);
  const workDir = path.join(outputDir, "_work", sanitizeFileName(workName || randomUUID()));
  const processedDir = path.join(workDir, "processed-images");
  const segmentDir = path.join(workDir, "segments");
  await mkdir(processedDir, { recursive: true });
  await mkdir(segmentDir, { recursive: true });

  const span = progressEnd - progressStart;
  const processed = [];
  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i];
    progress(job, Math.round(progressStart + span * (0.08 + (i / plan.length) * 0.28)), `${progressLabel}裁剪并改写 MD5：${item.name}`);
    const output = path.join(processedDir, item.processedFileName);
    await createProcessedImage(item.path, output, `auto-cut-${job.id}-${workName}-${i}-${Date.now()}`);
    const md5 = await hashFile(output);
    processed.push({ ...item, processedPath: output, processedMd5: md5, md5Changed: md5 !== item.md5 });
  }

  const segments = [];
  for (let i = 0; i < processed.length; i += 1) {
    const item = processed[i];
    progress(job, Math.round(progressStart + span * (0.36 + (i / processed.length) * 0.36)), `${progressLabel}生成运镜片段：${item.name}`);
    const segment = path.join(segmentDir, `${String(i + 1).padStart(3, "0")}.mp4`);
    await createSegment(item.processedPath, segment, item);
    segments.push(segment);
  }

  const outputFile = await uniqueOutputPath(outputDir, outputFileName);
  progress(job, Math.round(progressStart + span * 0.78), `${progressLabel}合成转场与视频`);
  await concatSegments(segments, outputFile, outputDir);
  return { outputFile, images: processed };
}

export function createJob(kind = "single") {
  const id = randomUUID();
  const job = {
    id,
    kind,
    status: "running",
    percent: 0,
    step: "等待开始",
    projects: kind === "batch" ? [] : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  jobs.set(id, job);
  return job;
}

export async function exportBatchJob(job, rootPath, orderedProjects = []) {
  try {
    progress(job, 2, "扫描批量素材");
    const batch = await scanBatchRoot(rootPath, orderedProjects);
    if (!batch.projects.length) throw new Error("总文件夹下没有找到含图片的子文件夹");
    await mkdir(batch.outputDir, { recursive: true });
    job.projects = batch.projects.map((project) => ({
      id: project.id,
      name: project.name,
      folderPath: project.folderPath,
      status: "waiting",
      percent: 0,
      outputFileName: project.outputFileName
    }));

    const exported = [];
    for (let i = 0; i < batch.projects.length; i += 1) {
      const project = batch.projects[i];
      const projectProgress = job.projects[i];
      projectProgress.status = "running";
      projectProgress.percent = 1;
      progress(job, Math.round((i / batch.projects.length) * 100), `导出 ${project.name}（${i + 1}/${batch.projects.length}）`);
      const result = await renderVideoFromImages({
        job,
        images: project.images,
        outputDir: batch.outputDir,
        outputFileName: project.outputFileName,
        workName: `${project.id}-${project.name}`,
        progressStart: Math.round((i / batch.projects.length) * 96) + 2,
        progressEnd: Math.round(((i + 1) / batch.projects.length) * 96) + 2,
        progressLabel: `${project.name}：`
      });
      projectProgress.status = "done";
      projectProgress.percent = 100;
      projectProgress.outputFile = result.outputFile;
      exported.push({ ...project, outputFile: result.outputFile, images: result.images });
    }

    const logFile = path.join(batch.outputDir, "last-batch-export-log.json");
    await writeFile(logFile, JSON.stringify({ id: job.id, rootPath: batch.rootPath, outputDir: batch.outputDir, projects: exported }, null, 2), "utf8");
    progress(job, 100, "批量导出完成", { status: "done", outputDir: batch.outputDir, logFile, projects: job.projects });
  } catch (error) {
    progress(job, job.percent || 0, "批量导出失败", { status: "error", error: error.message });
  }
}

export async function exportBatchProjectJob(job, rootPath, folderPath, orderedPaths = []) {
  try {
    progress(job, 3, "扫描当前子文件夹");
    const absoluteRoot = path.resolve(rootPath);
    const absoluteFolder = path.resolve(folderPath);
    const { images } = await scanFolderWithOrder(absoluteFolder, orderedPaths);
    if (!images.length) throw new Error("当前子文件夹中没有支持的图片");
    const project = makeProject(absoluteFolder, images, 0);
    const outputDir = path.join(absoluteRoot, "auto-cut-batch-output");
    await mkdir(outputDir, { recursive: true });
    const result = await renderVideoFromImages({
      job,
      images,
      outputDir,
      outputFileName: project.outputFileName,
      workName: `${project.id}-${project.name}`,
      progressStart: 4,
      progressEnd: 94,
      progressLabel: `${project.name}：`
    });
    const logFile = path.join(outputDir, "last-project-export-log.json");
    await writeFile(logFile, JSON.stringify({ id: job.id, rootPath: absoluteRoot, folderPath: absoluteFolder, outputDir, outputFile: result.outputFile, images: result.images }, null, 2), "utf8");
    progress(job, 100, "当前项目导出完成", { status: "done", outputDir, outputFile: result.outputFile, logFile, images: result.images });
  } catch (error) {
    progress(job, job.percent || 0, "当前项目导出失败", { status: "error", error: error.message });
  }
}

export function defaultSettings() {
  return {
    outputWidth: OUTPUT_WIDTH,
    outputHeight: OUTPUT_HEIGHT,
    fps: FPS,
    imageSeconds: IMAGE_SECONDS,
    transitionSeconds: TRANSITION_SECONDS,
    outputFormat: "mp4"
  };
}
