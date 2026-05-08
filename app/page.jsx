"use client";

import { useMemo, useState } from "react";

export default function HomePage() {
  const [folderPath, setFolderPath] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [jobStatus, setJobStatus] = useState("尚未开始");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [queueProjects, setQueueProjects] = useState([]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || projects[0] || null,
    [projects, activeProjectId]
  );
  const selectedImage = useMemo(
    () => activeProject?.images.find((image) => image.id === selectedImageId) || activeProject?.images[0] || null,
    [activeProject, selectedImageId]
  );
  const selectedPlan = activeProject?.plan?.find((item) => item.id === selectedImage?.id);
  const totalImages = projects.reduce((sum, project) => sum + project.images.length, 0);

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败");
    return data;
  }

  function orderedProjectsPayload(nextProjects = projects) {
    return nextProjects.map((project) => ({
      folderPath: project.folderPath,
      orderedPaths: project.images.map((image) => image.path)
    }));
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

  async function importBatch() {
    if (!folderPath.trim()) {
      setJobStatus("请先填写总文件夹路径");
      return;
    }
    setBusy(true);
    try {
      setJobStatus("正在扫描总文件夹...");
      const data = await api("/api/import-batch", {
        method: "POST",
        body: JSON.stringify({ rootPath: folderPath.trim() })
      });
      const nextProjects = data.projects.map((project, index) => ({ ...project, expanded: index === 0 }));
      setRootPath(data.rootPath);
      setOutputDir(data.outputDir);
      setProjects(nextProjects);
      setActiveProjectId(nextProjects[0]?.id || null);
      setSelectedImageId(nextProjects[0]?.images[0]?.id || null);
      setQueueProjects([]);
      setProgress(0);
      setJobStatus(`已导入 ${nextProjects.length} 个项目，共 ${data.totalImages} 张图片`);
    } catch (error) {
      setJobStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function previewProject(projectId) {
    setBusy(true);
    try {
      setJobStatus("正在生成预览...");
      const data = await api("/api/batch-preview", {
        method: "POST",
        body: JSON.stringify({ rootPath, orderedProjects: orderedProjectsPayload() })
      });
      const nextProjects = mergeProjectStatuses(data.projects);
      setProjects(nextProjects);
      setOutputDir(data.outputDir);
      setActiveProjectId(projectId);
      const project = nextProjects.find((item) => item.id === projectId);
      setSelectedImageId(project?.images[0]?.id || null);
      setJobStatus(`预览已更新：${project?.name || ""}`);
    } catch (error) {
      setJobStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportCurrent(project) {
    setBusy(true);
    try {
      setJobStatus(`正在导出当前项目：${project.name}`);
      setProgress(1);
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
      setJobStatus(error.message);
    }
  }

  async function exportBatch() {
    if (!projects.length) {
      setJobStatus("请先导入总文件夹");
      return;
    }
    setBusy(true);
    try {
      setJobStatus("正在创建批量导出任务...");
      setProgress(1);
      const data = await api("/api/batch-export", {
        method: "POST",
        body: JSON.stringify({ rootPath, orderedProjects: orderedProjectsPayload() })
      });
      watchProgress(data.jobId, "batch");
    } catch (error) {
      setBusy(false);
      setJobStatus(error.message);
    }
  }

  function watchProgress(jobId, mode) {
    const timer = window.setInterval(async () => {
      try {
        const job = await api(`/api/export/${jobId}/progress`);
        setJobStatus(`${job.step} · ${job.percent}%`);
        setProgress(job.percent);
        if (mode === "batch" && Array.isArray(job.projects)) setQueueProjects(job.projects);
        if (job.status === "done") {
          window.clearInterval(timer);
          setBusy(false);
          setJobStatus(job.step);
          setProgress(100);
          if (job.outputDir) setOutputDir(job.outputDir);
          if (mode === "batch" && Array.isArray(job.projects)) {
            setProjects((current) =>
              current.map((project) => {
                const jobProject = job.projects.find((item) => item.id === project.id);
                return jobProject ? { ...project, ...jobProject } : project;
              })
            );
          }
        }
        if (job.status === "error") {
          window.clearInterval(timer);
          setBusy(false);
          setJobStatus(job.error || job.step);
        }
      } catch (error) {
        window.clearInterval(timer);
        setBusy(false);
        setJobStatus(error.message);
      }
    }, 1000);
  }

  function toggleProject(projectId) {
    setProjects((current) =>
      current.map((project) =>
        project.id === projectId ? { ...project, expanded: !(project.expanded ?? project.id === activeProjectId) } : project
      )
    );
    const project = projects.find((item) => item.id === projectId);
    setActiveProjectId(projectId);
    if (project && !project.images.some((image) => image.id === selectedImageId)) {
      setSelectedImageId(project.images[0]?.id || null);
    }
  }

  function moveImage(projectId, sourceImageId, targetImageId) {
    setProjects((current) =>
      current.map((project) => {
        if (project.id !== projectId) return project;
        const images = [...project.images];
        const sourceIndex = images.findIndex((image) => image.id === sourceImageId);
        const targetIndex = images.findIndex((image) => image.id === targetImageId);
        if (sourceIndex < 0 || targetIndex < 0) return project;
        const [moved] = images.splice(sourceIndex, 1);
        images.splice(targetIndex, 0, moved);
        return { ...project, images, plan: [] };
      })
    );
    setActiveProjectId(projectId);
    setSelectedImageId(sourceImageId);
    setJobStatus("图片顺序已更新，请在左侧点击“预览”生成新计划");
  }

  const duration = activeProject
    ? activeProject.images.length * 3 - Math.max(0, activeProject.images.length - 1) * 0.5
    : 0;
  const imageIndex = activeProject && selectedImage
    ? activeProject.images.findIndex((image) => image.id === selectedImage.id) + 1
    : 0;
  const queueRows = queueProjects.length ? queueProjects : projects;

  return (
    <main className="app-shell">
      <section className="toolbar">
        <div>
          <h1>批量自动剪辑工具</h1>
          <p>总文件夹 → 子文件夹项目树 → 独立排序预览 → 批量导出竖屏 4K 视频</p>
        </div>
        <div className="status-pill">Next.js 本地运行</div>
      </section>

      <section className="path-panel">
        <label className="folder-path-label" htmlFor="folderPath">总文件夹路径</label>
        <div className="path-row">
          <input id="folderPath" value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="/Users/你的名字/Pictures/批量素材" />
          <button disabled={busy} onClick={importBatch}>导入总文件夹</button>
          <button disabled={busy} className="primary compact" onClick={exportBatch}>全部导出</button>
        </div>
        <div className="hint">总文件夹下面的每个含图片子文件夹会成为一个独立视频项目；如果总文件夹本身只有图片，也会作为单项目导入。</div>
      </section>

      <section className="workspace">
        <aside className="panel source-panel">
          <div className="panel-heading">
            <div>
              <h2>素材项目树</h2>
              <span>{projects.length ? `已识别 ${projects.length} 个视频项目` : "等待导入"}</span>
            </div>
            <span className="mini-badge">{totalImages} 图</span>
          </div>

          <div className="project-tree">
            {!projects.length && <div className="empty-state">输入总文件夹路径后点击“导入总文件夹”。</div>}
            {projects.map((project) => {
              const expanded = project.expanded ?? project.id === activeProjectId;
              const statusText = project.status === "done" ? "已完成" : project.status === "running" ? "导出中" : project.plan?.length ? "已预览" : "待预览";
              return (
                <div key={project.id} className={`tree-project ${project.id === activeProjectId ? "active" : ""}`}>
                  <div className="project-row" onClick={() => toggleProject(project.id)}>
                    <div>
                      <h3>{expanded ? "▾" : "▸"} {project.name}</h3>
                      <p className="meta">{project.images.length} 张图片 · {project.outputFileName}</p>
                    </div>
                    <span className="mini-badge">{statusText}</span>
                  </div>
                  {expanded && (
                    <>
                      <div className="project-actions">
                        <button disabled={busy} className="secondary" onClick={(event) => { event.stopPropagation(); previewProject(project.id); }}>预览</button>
                        <button disabled={busy} onClick={(event) => { event.stopPropagation(); exportCurrent(project); }}>导出当前</button>
                      </div>
                      <div className="tree-images">
                        {project.images.map((image, index) => {
                          const planItem = project.plan?.find((item) => item.id === image.id);
                          return (
                            <div
                              key={image.id}
                              className={`image-item ${project.id === activeProjectId && image.id === selectedImage?.id ? "selected" : ""}`}
                              draggable
                              onClick={() => { setActiveProjectId(project.id); setSelectedImageId(image.id); }}
                              onDragStart={(event) => event.dataTransfer.setData("text/plain", JSON.stringify({ projectId: project.id, imageId: image.id }))}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                const source = JSON.parse(event.dataTransfer.getData("text/plain") || "{}");
                                if (source.projectId === project.id && source.imageId !== image.id) moveImage(project.id, source.imageId, image.id);
                              }}
                            >
                              <div className="drag-handle">↕</div>
                              <div className="thumb"><img src={`/api/image?path=${encodeURIComponent(image.path)}`} alt={image.name} /></div>
                              <div className="image-meta">
                                <strong title={image.name}>{String(index + 1).padStart(2, "0")} · {image.name}</strong>
                                <span>{planItem ? planItem.motion.label : `${image.width}×${image.height}`}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="panel preview-panel">
          <div className="panel-heading">
            <div>
              <h2>画面预览</h2>
              <span>{activeProject && selectedImage ? `${activeProject.name} / ${selectedImage.name}` : "在左侧操作预览"}</span>
            </div>
            <span className="mini-badge">{activeProject && selectedImage ? `第 ${imageIndex} / ${activeProject.images.length} 张` : "未选择"}</span>
          </div>
          <div className="phone-frame">
            <div className={`motion-card ${selectedPlan ? "animated" : ""}`}>
              <div className="motion-border" />
              {selectedImage ? (
                <>
                  <img className="preview-image" src={`/api/image?path=${encodeURIComponent(selectedImage.path)}`} alt={selectedImage.name} />
                  <div className="preview-caption">
                    <strong title={selectedImage.name}>{selectedImage.name}</strong>
                    <span>{selectedPlan ? `${selectedPlan.motion.label} · 缩放 ${selectedPlan.motion.zoom}x · 3 秒` : `${selectedImage.width}×${selectedImage.height} · 原图预览`}</span>
                  </div>
                </>
              ) : (
                <>
                  <strong>等待导入图片</strong>
                  <span>导入后在左侧操作预览</span>
                </>
              )}
            </div>
          </div>
          <div className="project-stats">
            {activeProject && (
              <>
                <div className="stat"><small>当前视频</small><strong>{activeProject.images.length} 张 · {duration.toFixed(1)} 秒</strong></div>
                <div className="stat"><small>输出规格</small><strong>2160×3840</strong></div>
                <div className="stat"><small>视频文件名</small><strong title={activeProject.outputFileName}>{activeProject.outputFileName}</strong></div>
              </>
            )}
          </div>
        </section>

        <aside className="panel export-panel">
          <div className="panel-heading">
            <div>
              <h2>批量导出队列</h2>
              <span>一个子文件夹生成一个 MP4 文件</span>
            </div>
          </div>
          <div className="setting"><span>输出规格</span><strong>2160×3840 · 30fps</strong></div>
          <div className="setting"><span>默认节奏</span><strong>3 秒 / 图 · 0.5 秒转场</strong></div>
          <div className="output-box">输出目录：{outputDir || "导入后显示"}</div>
          <div className="progress"><div className="progress-bar" style={{ width: `${progress}%` }} /></div>
          <div className="job-status">{jobStatus}</div>
          <div className="queue-list">
            {!queueRows.length && <div className="empty-state">批量导出开始后显示每个视频状态。</div>}
            {queueRows.map((project) => {
              const statusText = { waiting: "等待", running: "处理中", done: "完成", error: "失败", ready: "待导出" }[project.status] || "待导出";
              return (
                <div key={project.id} className="queue-row">
                  <div className="queue-top">
                    <h3 title={project.outputFile || project.outputFileName}>{project.outputFileName || `${project.name}.mp4`}</h3>
                    <small>{statusText}</small>
                  </div>
                  <div className="bar"><span style={{ width: `${Number(project.percent || 0)}%` }} /></div>
                </div>
              );
            })}
          </div>
        </aside>
      </section>
    </main>
  );
}
