import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.dirname(__dirname);
const outDir = path.join(projectRoot, "sample-images");

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}\n${stderr}`));
    });
  });
}

const samples = [
  { name: "01-horizontal.jpg", size: "3200x1800", colors: ["#c7e7ff", "#ffcf99"], label: "Horizontal" },
  { name: "02-vertical.jpg", size: "1800x3200", colors: ["#d7f5cf", "#ffe6ef"], label: "Vertical" },
  { name: "03-square.jpg", size: "2400x2400", colors: ["#f8e9a1", "#b8d8d8"], label: "Square" },
  { name: "04-ultrawide.jpg", size: "4200x1400", colors: ["#c9c5ff", "#f7d6bf"], label: "Ultra Wide" },
  { name: "05-ultratall.jpg", size: "1400x4200", colors: ["#bfe8d9", "#ffd1dc"], label: "Ultra Tall" }
];

await mkdir(outDir, { recursive: true });

for (const sample of samples) {
  const output = path.join(outDir, sample.name);
  await runProcess("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `color=${sample.colors[0]}:s=${sample.size}:d=1`,
    "-vf", [
      `drawbox=x=iw*0.08:y=ih*0.08:w=iw*0.84:h=ih*0.84:color=${sample.colors[1]}@0.9:t=fill`,
      "drawbox=x=iw*0.16:y=ih*0.16:w=iw*0.68:h=ih*0.68:color=white@0.55:t=12",
      "drawbox=x=iw*0.32:y=ih*0.32:w=iw*0.36:h=ih*0.36:color=0x1c2420@0.18:t=fill",
      "drawbox=x=iw*0.42:y=ih*0.1:w=iw*0.16:h=ih*0.8:color=0xffffff@0.35:t=fill"
    ].join(","),
    "-frames:v", "1",
    "-q:v", "2",
    output
  ]);
}

console.log(outDir);
