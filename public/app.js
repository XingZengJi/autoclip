const folderPathInput = document.querySelector("#folderPath");
const importButton = document.querySelector("#importButton");
const exportButton = document.querySelector("#exportButton");
const projectTree = document.querySelector("#projectTree");
const imageCount = document.querySelector("#imageCount");
const projectSummary = document.querySelector("#projectSummary");
const previewTitle = document.querySelector("#previewTitle");
const previewSubtitle = document.querySelector("#previewSubtitle");
const previewIndex = document.querySelector("#previewIndex");
const motionCard = document.querySelector("#motionCard");
const projectStats = document.querySelector("#projectStats");
const progressBar = document.querySelector("#progressBar");
const jobStatus = document.querySelector("#jobStatus");
const outputBox = document.querySelector("#outputBox");
const queueList = document.querySelector("#queueList");

let rootPath = "";
let outputDir = "";
let projects = [];
let activeProjectId = null;
let selectedImageId = null;
let progressTimer = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function folderPath() {
  return folderPathInput.value.trim();
}

function setBusy(isBusy) {
  importButton.disabled = isBusy;
  exportButton.disabled = isBusy;
  projectTree.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy;
  });
}

function activeProject() {
  return projects.find((project) => project.id === activeProjectId) || projects[0] || null;
}

function selectedImage(project = activeProject()) {
  if (!project) return null;
  return project.images.find((image) => image.id === selectedImageId) || project.images[0] || null;
}

function orderedProjectsPayload() {
  return projects.map((project) => ({
    folderPath: project.folderPath,
    orderedPaths: project.images.map((image) => image.path)
  }));
}

async function importBatch() {
  if (!folderPath()) {
    setStatus("请先填写总文件夹路径");
    return;
  }
  setBusy(true);
  try {
    setStatus("正在扫描总文件夹...");
    const data = await api("/api/import-batch", {
      method: "POST",
      body: JSON.stringify({ rootPath: folderPath() })
    });
    rootPath = data.rootPath;
    outputDir = data.outputDir;
    projects = data.projects;
    activeProjectId = projects[0]?.id || null;
    selectedImageId = projects[0]?.images[0]?.id || null;
    renderAll();
    setStatus(`已导入 ${projects.length} 个项目，共 ${data.totalImages} 张图片`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function previewProject(projectId) {
  const project = projects.find((item) => item.id === projectId);
  if (!project) return;
  activeProjectId = project.id;
  selectedImageId = selectedImage(project)?.id || null;
  setBusy(true);
  try {
    setStatus(`正在生成预览：${project.name}`);
    const data = await api("/api/batch-preview", {
      method: "POST",
      body: JSON.stringify({ rootPath, orderedProjects: orderedProjectsPayload() })
    });
    projects = mergeProjectStatuses(data.projects);
    outputDir = data.outputDir;
    activeProjectId = projectId;
    ensureSelection();
    renderAll();
    setStatus(`预览已更新：${activeProject()?.name || ""}`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function exportCurrent(projectId) {
  const project = projects.find((item) => item.id === projectId);
  if (!project) return;
  setBusy(true);
  try {
    setStatus(`正在导出当前项目：${project.name}`, 1);
    const data = await api("/api/batch-export-current", {
      method: "POST",
      body: JSON.stringify({
        rootPath,
        folderPath: project.folderPath,
        orderedPaths: project.images.map((image) => image.path)
      })
    });
    watchProgress(data.jobId, "single");
  } catch (error) {
    setBusy(false);
    setStatus(error.message);
  }
}

async function exportBatch() {
  if (!projects.length) {
    setStatus("请先导入总文件夹");
    return;
  }
  setBusy(true);
  queueList.innerHTML = "";
  try {
    setStatus("正在创建批量导出任务...", 1);
    const data = await api("/api/batch-export", {
      method: "POST",
      body: JSON.stringify({ rootPath, orderedProjects: orderedProjectsPayload() })
    });
    watchProgress(data.jobId, "batch");
  } catch (error) {
    setBusy(false);
    setStatus(error.message);
  }
}

function mergeProjectStatuses(nextProjects) {
  const currentById = new Map(projects.map((project) => [project.id, project]));
  return nextProjects.map((project) => ({
    status: currentById.get(project.id)?.status || "ready",
    percent: currentById.get(project.id)?.percent || 0,
    expanded: currentById.get(project.id)?.expanded ?? project.id === activeProjectId,
    ...project
  }));
}

function ensureSelection() {
  const project = activeProject();
  if (!project) {
    selectedImageId = null;
    return;
  }
  if (!project.images.some((image) => image.id === selectedImageId)) {
    selectedImageId = project.images[0]?.id || null;
  }
}

function renderAll() {
  ensureSelection();
  renderProjectTree();
  renderPreview();
  renderQueue();
  const totalImages = projects.reduce((sum, project) => sum + project.images.length, 0);
  imageCount.textContent = `${totalImages} 图`;
  projectSummary.textContent = projects.length ? `已识别 ${projects.length} 个视频项目` : "等待导入";
  outputBox.textContent = outputDir ? `输出目录：${outputDir}` : "输出目录会在导入后显示";
}

function renderProjectTree() {
  if (!projects.length) {
    projectTree.innerHTML = `<div class="empty-state">输入总文件夹路径后点击“导入总文件夹”。</div>`;
    return;
  }

  projectTree.innerHTML = projects.map((project) => {
    const expanded = project.expanded ?? project.id === activeProjectId;
    const active = project.id === activeProjectId;
    const statusText = project.status === "done" ? "已完成" : project.status === "running" ? "导出中" : project.plan?.length ? "已预览" : "待预览";
    const rows = expanded ? `
      <div class="project-actions">
        <button class="secondary" data-action="preview" data-project-id="${escapeHtml(project.id)}">预览</button>
        <button data-action="export-current" data-project-id="${escapeHtml(project.id)}">导出当前</button>
      </div>
      <div class="tree-images">
        ${project.images.map((image, index) => renderImageRow(project, image, index)).join("")}
      </div>
    ` : "";

    return `
      <div class="tree-project ${active ? "active" : ""}" data-project-id="${escapeHtml(project.id)}">
        <div class="project-row" data-action="toggle-project" data-project-id="${escapeHtml(project.id)}">
          <div>
            <h3>${expanded ? "▾" : "▸"} ${escapeHtml(project.name)}</h3>
            <p class="meta">${project.images.length} 张图片 · ${escapeHtml(project.outputFileName)}</p>
          </div>
          <span class="mini-badge">${statusText}</span>
        </div>
        ${rows}
      </div>
    `;
  }).join("");

  bindTreeEvents();
}

function renderImageRow(project, image, index) {
  const selected = project.id === activeProjectId && image.id === selectedImageId;
  const planItem = project.plan?.find((item) => item.id === image.id);
  const motionText = planItem ? planItem.motion.label : `${image.width}×${image.height}`;
  return `
    <div class="image-item ${selected ? "selected" : ""}" draggable="true" data-project-id="${escapeHtml(project.id)}" data-image-id="${escapeHtml(image.id)}">
      <div class="drag-handle" title="拖拽排序">↕</div>
      <div class="thumb"><img src="/api/image?path=${encodeURIComponent(image.path)}" alt="${escapeHtml(image.name)}"></div>
      <div class="image-meta">
        <strong title="${escapeHtml(image.name)}">${String(index + 1).padStart(2, "0")} · ${escapeHtml(image.name)}</strong>
        <span>${escapeHtml(motionText)}</span>
      </div>
    </div>
  `;
}

function bindTreeEvents() {
  projectTree.querySelectorAll("[data-action='toggle-project']").forEach((row) => {
    row.addEventListener("click", () => {
      const project = projects.find((item) => item.id === row.dataset.projectId);
      if (!project) return;
      const wasExpanded = project.expanded ?? project.id === activeProjectId;
      activeProjectId = project.id;
      project.expanded = !wasExpanded;
      if (project.expanded && !project.images.some((image) => image.id === selectedImageId)) {
        selectedImageId = project.images[0]?.id || null;
      }
      renderAll();
    });
  });

  projectTree.querySelectorAll("[data-action='preview']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      previewProject(button.dataset.projectId);
    });
  });

  projectTree.querySelectorAll("[data-action='export-current']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      exportCurrent(button.dataset.projectId);
    });
  });

  bindImageClicks();
  bindDragSorting();
}

function bindImageClicks() {
  projectTree.querySelectorAll(".image-item").forEach((item) => {
    item.addEventListener("click", (event) => {
      if (event.target.closest(".drag-handle")) return;
      activeProjectId = item.dataset.projectId;
      selectedImageId = item.dataset.imageId;
      renderAll();
    });
  });
}

function bindDragSorting() {
  let dragged = null;

  projectTree.querySelectorAll(".image-item").forEach((item) => {
    item.addEventListener("dragstart", (event) => {
      dragged = { projectId: item.dataset.projectId, imageId: item.dataset.imageId };
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", JSON.stringify(dragged));
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      projectTree.querySelectorAll(".image-item").forEach((row) => row.classList.remove("drop-target"));
      dragged = null;
    });

    item.addEventListener("dragover", (event) => {
      if (!dragged || dragged.projectId !== item.dataset.projectId) return;
      event.preventDefault();
      if (dragged.imageId !== item.dataset.imageId) item.classList.add("drop-target");
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drop-target");
    });

    item.addEventListener("drop", (event) => {
      event.preventDefault();
      item.classList.remove("drop-target");
      const source = dragged || JSON.parse(event.dataTransfer.getData("text/plain") || "{}");
      if (!source.projectId || source.projectId !== item.dataset.projectId || source.imageId === item.dataset.imageId) return;
      moveImage(source.projectId, source.imageId, item.dataset.imageId);
    });
  });
}

function moveImage(projectId, sourceImageId, targetImageId) {
  const project = projects.find((item) => item.id === projectId);
  if (!project) return;
  const sourceIndex = project.images.findIndex((image) => image.id === sourceImageId);
  const targetIndex = project.images.findIndex((image) => image.id === targetImageId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [moved] = project.images.splice(sourceIndex, 1);
  project.images.splice(targetIndex, 0, moved);
  project.plan = [];
  activeProjectId = project.id;
  selectedImageId = moved.id;
  setStatus(`${project.name} 的图片顺序已更新，点击该项目下的“预览”生成新计划`);
  renderAll();
}

function renderPreview() {
  const project = activeProject();
  const image = selectedImage(project);
  const planItem = project?.plan?.find((item) => item.id === image?.id);

  motionCard.classList.toggle("animated", Boolean(planItem));

  if (!project || !image) {
    previewTitle.textContent = "画面预览";
    previewSubtitle.textContent = "在左侧操作预览";
    previewIndex.textContent = "未选择";
    motionCard.innerHTML = `
      <div class="motion-border"></div>
      <strong>等待导入图片</strong>
      <span>导入后在左侧操作预览</span>
    `;
    projectStats.innerHTML = "";
    return;
  }

  const imageIndex = project.images.findIndex((item) => item.id === image.id) + 1;
  const duration = project.images.length * 3 - Math.max(0, project.images.length - 1) * 0.5;
  previewTitle.textContent = "画面预览";
  previewSubtitle.textContent = `${project.name} / ${image.name}`;
  previewIndex.textContent = `第 ${imageIndex} / ${project.images.length} 张`;

  const caption = planItem
    ? `${planItem.motion.label} · 缩放 ${planItem.motion.zoom}x · 3 秒`
    : `${image.width}×${image.height} · 原图预览`;

  motionCard.innerHTML = `
    <div class="motion-border"></div>
    <img class="preview-image" src="/api/image?path=${encodeURIComponent(image.path)}" alt="${escapeHtml(image.name)}">
    <div class="preview-caption">
      <strong title="${escapeHtml(image.name)}">${escapeHtml(image.name)}</strong>
      <span>${escapeHtml(caption)}</span>
    </div>
  `;

  projectStats.innerHTML = `
    <div class="stat">
      <small>当前视频</small>
      <strong>${project.images.length} 张 · ${duration.toFixed(1)} 秒</strong>
    </div>
    <div class="stat">
      <small>输出规格</small>
      <strong>2160×3840</strong>
    </div>
    <div class="stat">
      <small>视频文件名</small>
      <strong title="${escapeHtml(project.outputFileName)}">${escapeHtml(project.outputFileName)}</strong>
    </div>
  `;
}

function renderQueue(jobProjects = null) {
  const rows = jobProjects || projects.map((project) => ({
    id: project.id,
    name: project.name,
    status: project.status || "ready",
    percent: project.percent || 0,
    outputFileName: project.outputFileName,
    outputFile: project.outputFile
  }));

  if (!rows.length) {
    queueList.innerHTML = `<div class="empty-state">批量导出开始后显示每个视频状态。</div>`;
    return;
  }

  queueList.innerHTML = rows.map((project) => {
    const statusText = {
      waiting: "等待",
      running: "处理中",
      done: "完成",
      error: "失败",
      ready: "待导出"
    }[project.status] || "待导出";
    return `
      <div class="queue-row">
        <div class="queue-top">
          <h3 title="${escapeHtml(project.outputFile || project.outputFileName || project.name)}">${escapeHtml(project.outputFileName || `${project.name}.mp4`)}</h3>
          <small>${statusText}</small>
        </div>
        <div class="bar"><span style="width:${Number(project.percent || 0)}%"></span></div>
      </div>
    `;
  }).join("");
}

function watchProgress(jobId, mode) {
  clearInterval(progressTimer);
  progressTimer = setInterval(async () => {
    try {
      const job = await api(`/api/export/${jobId}/progress`);
      setStatus(`${job.step} · ${job.percent}%`, job.percent);
      if (mode === "batch" && Array.isArray(job.projects)) {
        renderQueue(job.projects);
      }
      if (job.status === "done") {
        clearInterval(progressTimer);
        setBusy(false);
        setStatus(job.step, 100);
        if (job.outputDir) outputBox.textContent = `输出目录：${job.outputDir}`;
        if (mode === "batch" && Array.isArray(job.projects)) {
          projects = projects.map((project) => {
            const jobProject = job.projects.find((item) => item.id === project.id);
            return jobProject ? { ...project, ...jobProject, status: jobProject.status, percent: jobProject.percent } : project;
          });
          renderAll();
        }
      }
      if (job.status === "error") {
        clearInterval(progressTimer);
        setBusy(false);
        setStatus(job.error || job.step);
      }
    } catch (error) {
      clearInterval(progressTimer);
      setBusy(false);
      setStatus(error.message);
    }
  }, 1000);
}

function setStatus(message, percent = null) {
  jobStatus.textContent = message;
  if (percent !== null) progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

importButton.addEventListener("click", importBatch);
exportButton.addEventListener("click", exportBatch);
renderAll();
