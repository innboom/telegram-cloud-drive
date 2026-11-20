import { createMediaPreview } from "./media-preview.js";
import "./notifications.js";
import { previewType } from "./media-types.js";
import { observeCovers } from "./media-covers.js";
import { fileIcon } from "./file-icons.js";
import { formatEntryDate, formatEntryKind, formatEntrySize } from "./entry-format.js";
import { clearLocalizedValue, language, localizeDrive, localizeValue, translate } from "./drive-i18n.js";
import { bindViewSwitch } from "./view-switch.js";
import { createUploadFeedback, droppedItems, pastedFiles, selectedDirectoryItems, uploadDirectories, uploadFile } from "./uploads.js";

const $ = (id) => document.getElementById(id);
localizeDrive();
let folderCode = folderCodeFromPath(location.pathname);
const form = $("inbox-form");
const sortSelect = $("inbox-search").elements.sort;
const note = $("inbox-note");
const sendNote = $("inbox-send-note");
const panel = $("inbox-panel");
const input = $("inbox-files");
const submit = $("inbox-submit");
const directoryInput = $("inbox-directory");
const chooseDirectory = $("inbox-choose-directory");
const mkdir = $("inbox-mkdir");
const status = $("inbox-status");
const pageSize = 50;
let page = 0;
let visibleEntries = [];
let hasMore = false;
let maxUploadMiB;
let listing = 0;
let query = "";
let fileType = "";
let sort = sortSelect.value;
let navigating = false;
let searchTimer;
let treeSnapshot;

let covers;
const more = $("inbox-more");
const moreRetry = $("inbox-more-retry");
const moreObserver = new IntersectionObserver(entries => {
  if (!more.hidden && entries.some(entry => entry.isIntersecting)) void loadMore();
}, { rootMargin: "80px" });

function showMore(available) {
  moreObserver.unobserve(more);
  more.hidden = !available;
  if (available) moreObserver.observe(more);
}

const viewSwitch = $("inbox-view-switch");
bindViewSwitch(viewSwitch, "cloud-drive-inbox-view", "grid", (view) => {
  $("inbox-entries").classList.toggle("inbox-list", view === "list");
});

function folderCodeFromPath(pathname) {
  return pathname.match(/^\/s\/([a-zA-Z0-9_-]{12}|[a-f0-9]{18})$/)?.[1];
}

function folderAddress(code) {
  return "/s/" + code;
}

function folderQuery(fields, target = folderCode) {
  return "/api/inbox/" + target + "?" + new URLSearchParams(fields);
}

async function request(path, options) {
  const response = await fetch(path, { ...options, credentials: "omit" });
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    const fallback = response.status === 413 ? "文件超过上传限制。" : "请求失败，请稍后重试。";
    throw Object.assign(new Error(translate(language === "zh" ? error ?? fallback : fallback)), { status: response.status });
  }
  return response;
}

function fileAddress(item) {
  return "/api/share/" + item.folder_file_code + "/download";
}

async function downloadFile(item) {
  const blob = await (await request(fileAddress(item))).blob();
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = item.name;
    link.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function previewAddress(item) {
  return new URL("/s/" + item.folder_file_code, location.origin).href;
}

const preview = createMediaPreview($("inbox-preview"), {
  load: async (item, _type, signal) => (await request(fileAddress(item), { signal })).blob(),
  download: downloadFile,
  address: previewAddress,
  openTab: item => window.open(previewAddress(item), "_blank", "noopener,noreferrer"),
  translate
});

function renderEntry(item) {
  const row = document.createElement("li");
  const isFolder = item.kind === "folder";
  const type = previewType(item);
  const open = document.createElement("a");
  open.className = "inbox-tile";
  open.title = item.name;
  open.href = isFolder ? folderAddress(item.folder_code) : previewAddress(item);
  const icon = document.createElement("span");
  icon.className = "inbox-icon " + (isFolder ? "icon-folder" : "inbox-file-art");
  if (!isFolder) icon.append(fileIcon(item.name, type));
  if (!isFolder && (type?.startsWith("image/") || type?.startsWith("video/"))) {
    icon.dataset.coverType = type;
    icon.dataset.coverSource = fileAddress(item);
  }
  const art = document.createElement("span");
  art.className = "inbox-art";
  art.setAttribute("aria-hidden", "true");
  art.append(icon);
  const name = document.createElement("span");
  name.className = "inbox-name";
  name.textContent = item.name;
  const info = document.createElement("span");
  info.className = "inbox-info";
  info.append(name);
  const meta = document.createElement("span");
  meta.className = "inbox-meta";
  const kind = document.createElement("span");
  kind.className = "inbox-kind";
  localizeValue(kind, () => translate(formatEntryKind(item)));
  meta.append(kind);
  if (!isFolder && Number.isFinite(item.size)) {
    const size = document.createElement("span");
    size.className = "inbox-size";
    size.textContent = formatEntrySize(item.size);
    meta.append(size);
  }
  if (item.created_at) {
    const time = document.createElement("time");
    time.dateTime = item.created_at;
    localizeValue(time, () => formatEntryDate(item.created_at));
    meta.append(time);
  }
  info.append(meta);
  const feedback = document.createElement("span");
  feedback.className = "inbox-file-feedback";
  feedback.setAttribute("role", "status");
  function bindDownload(link) {
    link.addEventListener("click", async event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (row.getAttribute("aria-busy") === "true") return;
      row.setAttribute("aria-busy", "true");
      localizeValue(feedback, () => translate("正在准备下载…"));
      try {
        await downloadFile(item);
        localizeValue(feedback, () => translate("已交给浏览器下载"));
      } catch (error) {
        clearLocalizedValue(feedback);
        feedback.textContent = error.message;
      } finally {
        row.removeAttribute("aria-busy");
      }
    });
  }
  open.append(art, info);
  row.append(open);
  if (isFolder) {
    open.dataset.folderLink = "";
  } else {
    open.addEventListener("click", event => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      preview(item, visibleEntries);
    });
    const download = document.createElement("a");
    download.className = "inbox-download";
    download.href = fileAddress(item);
    download.download = item.name;
    localizeValue(download, () => translate("下载"));
    bindDownload(download);
    row.append(download);
    row.append(feedback);
  }
  return row;
}

function renderBreadcrumbs(data) {
  const path = $("inbox-path");
  const current = $("inbox-title").parentElement;
  const byId = new Map((data.folders ?? []).map(item => [item.id, item]));
  const ancestors = [];
  const seen = new Set();
  for (let id = data.parent; !data.root && byId.has(id) && !seen.has(id); id = byId.get(id).parent_id) {
    seen.add(id);
    const item = byId.get(id);
    const crumb = document.createElement("li");
    const link = document.createElement("a");
    link.href = folderAddress(item.folder_code);
    link.dataset.folderLink = "";
    link.textContent = item.name;
    link.title = item.name;
    crumb.append(link);
    ancestors.push(crumb);
    if (id === data.rootId) break;
  }
  ancestors.reverse();
  if (ancestors.length < 3) {
    path.replaceChildren(...ancestors, current);
    return;
  }

  const collapsed = document.createElement("li");
  const menu = document.createElement("details");
  menu.className = "inbox-path-menu";
  const trigger = document.createElement("summary");
  trigger.textContent = "…";
  localizeValue(trigger, () => translate("上级目录"), "@aria-label");
  const links = document.createElement("div");
  links.className = "action-panel";
  links.append(...ancestors.slice(1).map(crumb => crumb.firstElementChild));
  menu.append(trigger, links);
  collapsed.append(menu);
  path.replaceChildren(ancestors[0], collapsed, current);
}

function renderFolderTree(data) {
  const tree = $("inbox-tree");
  const children = new Map();
  const current = data.id;
  const byId = new Map(data.folders.map(item => [item.id, item]));
  const ancestors = new Set();
  for (let item = byId.get(current); item && !ancestors.has(item.id); item = byId.get(item.parent_id)) {
    ancestors.add(item.id);
  }
  const snapshot = JSON.stringify(data.folders);
  if (snapshot === treeSnapshot) {
    for (const link of tree.querySelectorAll(".tree-folder")) {
      if (link.dataset.folderId === current) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
    for (const toggle of tree.querySelectorAll('.tree-toggle[aria-expanded="false"]')) {
      if (toggle.dataset.folder !== current && ancestors.has(toggle.dataset.folder)) toggle.click();
    }
    return;
  }
  const expanded = new Set([...tree.querySelectorAll('[aria-expanded="true"]')].map(toggle => toggle.dataset.folder));
  for (const item of data.folders) {
    if (!children.has(item.parent_id)) children.set(item.parent_id, []);
    children.get(item.parent_id).push(item);
  }
  function branch(parent) {
    const list = document.createElement("ul");
    if (parent !== null) list.className = "folder-tree";
    else list.className = "inbox-tree-root";
    for (const item of children.get(parent) ?? []) {
      const node = document.createElement("li");
      const row = document.createElement("div");
      row.className = "tree-row";
      node.append(row);
      if (children.has(item.id)) {
        const nested = branch(item.id);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "tree-toggle";
        toggle.dataset.folder = item.id;
        localizeValue(toggle, () => translate("{name}的子目录", { name: item.name }), "@aria-label");
        const setExpanded = open => {
          nested.hidden = !open;
          toggle.setAttribute("aria-expanded", String(open));
        };
        setExpanded(tree.childElementCount ? expanded.has(item.id) : ancestors.has(item.id));
        toggle.addEventListener("click", () => setExpanded(nested.hidden));
        row.append(toggle);
        node.append(nested);
      }
      const link = document.createElement("a");
      link.className = "tree-folder";
      link.dataset.folderId = item.id;
      link.dataset.folderLink = "";
      link.href = folderAddress(item.folder_code);
      link.title = item.name;
      if (item.id === current) link.setAttribute("aria-current", "location");
      const icon = document.createElement("span");
      icon.className = "icon icon-folder";
      icon.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.className = "tree-folder-name";
      name.textContent = item.name;
      link.append(icon, name);
      row.append(link);
      list.append(node);
    }
    return list;
  }
  tree.replaceChildren(branch(null));
  treeSnapshot = snapshot;
  $("inbox-sidebar").hidden = false;
}

async function loadFolder(target = folderCode, offsetPage = 0, historyMode, filters = { query, fileType, sort }) {
  const sequence = ++listing;
  showMore(false);
  moreRetry.hidden = true;
  const timeout = AbortSignal.timeout(15000);
  let data;
  try {
    const response = await request(folderQuery({
      offset: offsetPage * pageSize, q: filters.query, sort: filters.sort, type: filters.fileType,
      ...(offsetPage > 0 ? { tree: "0" } : {})
    }, target), { signal: timeout });
    data = await response.json();
  } catch (error) {
    if (sequence !== listing) return;
    if (hasMore && error.status !== 404) {
      if (offsetPage > 0) moreRetry.hidden = false;
      else showMore(true);
    }
    if (timeout.aborted) throw new Error(translate("文件夹加载超时，请重试。"));
    throw error;
  }
  if (sequence !== listing) return;
  const grid = $("inbox-entries");
  if (offsetPage > 0) {
    const rows = document.createDocumentFragment();
    const existing = new Set(visibleEntries.map(item => item.id));
    const added = data.entries.filter(item => !existing.has(item.id));
    visibleEntries.push(...added);
    for (const item of added) rows.append(renderEntry(item));
    covers.observe(rows);
    grid.append(rows);
    page = offsetPage;
    hasMore = data.hasMore;
    showMore(hasMore);
    return;
  }
  if (historyMode === "push") history.pushState(null, "", folderAddress(target));
  if (folderCode !== target || page !== offsetPage || query !== filters.query || fileType !== filters.fileType || sort !== filters.sort) {
    panel.querySelector(".file-scroll").scrollTop = 0;
  }
  ({ query, fileType, sort } = filters);
  if (historyMode) {
    $("inbox-query").value = query;
    $("inbox-type").value = fileType;
    sortSelect.value = sort;
  }
  folderCode = target;
  page = offsetPage;
  maxUploadMiB = data.maxUploadMiB;
  document.title = data.name;
  $("inbox-title").textContent = data.name;
  $("inbox-title").title = data.name;
  renderBreadcrumbs(data);
  if (data.folders) renderFolderTree(data);
  visibleEntries = data.entries;
  covers?.disconnect();
  grid.replaceChildren(...visibleEntries.map(renderEntry));
  covers = observeCovers(grid);
  $("inbox-empty").hidden = data.entries.length > 0;
  localizeValue($("inbox-empty"), () => translate(query || fileType ? "没有找到匹配的文件或文件夹。" : "这个文件夹还没有文件。"));
  hasMore = data.hasMore;
  showMore(hasMore);
  form.hidden = false;
  $("inbox-search").hidden = false;
}

async function navigateFolder(target, historyMode) {
  clearTimeout(searchTimer);
  navigating = true;
  const loading = $("inbox-folder-loading");
  loading.hidden = false;
  const expected = listing + 1;
  try {
    await loadFolder(target, 0, historyMode, { query: "", fileType: "", sort });
  } catch (error) {
    if (historyMode === "pop") history.replaceState(null, "", folderAddress(folderCode));
    clearLocalizedValue(status);
    status.textContent = error.message;
  } finally {
    if (expected === listing) {
      navigating = false;
      loading.hidden = true;
    }
  }
}

panel.addEventListener("click", event => {
  const link = event.target.closest("a[data-folder-link]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (submit.disabled) return;
  const target = folderCodeFromPath(new URL(link.href).pathname);
  if (target && (target !== folderCode || navigating)) void navigateFolder(target, "push");
});
window.addEventListener("popstate", () => {
  closeShareMenu();
  const target = folderCodeFromPath(location.pathname);
  if (target) void navigateFolder(target, "pop");
});

const copyShare = $("inbox-copy-share");
let shareLink;

function closeShareMenu(restoreFocus = false) {
  const link = shareLink;
  shareLink = null;
  copyShare.hidden = true;
  if (restoreFocus && link?.isConnected) link.focus({ preventScroll: true });
}

panel.addEventListener("contextmenu", event => {
  const link = event.target.closest("a[data-folder-link]") ??
    event.target.closest("#inbox-entries > li")?.querySelector(".inbox-tile");
  if (!link) return;
  event.preventDefault();
  shareLink = link;
  copyShare.hidden = false;
  const { left, bottom } = link.getBoundingClientRect();
  const keyboard = event.clientX === 0 && event.clientY === 0;
  const x = keyboard ? left : event.clientX;
  const y = keyboard ? bottom : event.clientY;
  const margin = 8;
  copyShare.style.left = Math.max(margin, Math.min(x, document.documentElement.clientWidth - copyShare.offsetWidth - margin)) + "px";
  copyShare.style.top = Math.max(margin, Math.min(y, document.documentElement.clientHeight - copyShare.offsetHeight - margin)) + "px";
  copyShare.focus({ preventScroll: true });
});

copyShare.addEventListener("click", async () => {
  const url = shareLink?.href;
  closeShareMenu(true);
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    localizeValue(status, () => translate("已复制公开链接"));
  } catch {
    prompt(translate("复制分享链接"), url);
  }
});
copyShare.addEventListener("blur", () => closeShareMenu());
copyShare.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeShareMenu(true);
});
document.addEventListener("pointerdown", event => {
  if (shareLink && !copyShare.contains(event.target)) closeShareMenu();
});
window.addEventListener("scroll", () => { if (shareLink) closeShareMenu(); }, { capture: true, passive: true });
window.addEventListener("resize", () => { if (shareLink) closeShareMenu(); });

function folderError(error) {
  clearLocalizedValue(status);
  status.textContent = error.message;
  if (error.status === 404) {
    $("inbox-sidebar").hidden = true;
    form.hidden = true;
    $("inbox-search").hidden = true;
    covers?.disconnect();
    hasMore = false;
    showMore(false);
    moreRetry.hidden = true;
    $("inbox-entries").replaceChildren();
    $("inbox-empty").hidden = true;
  }
}

async function createFolder(name, target = folderCode) {
  const response = await request(folderQuery({ action: "mkdir" }, target), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  return (await response.json()).folder_code;
}

function setUploadBusy(busy) {
  input.disabled = directoryInput.disabled = submit.disabled = chooseDirectory.disabled = mkdir.disabled = busy;
  note.readOnly = busy;
  updateSendNote();
}

function updateSendNote() {
  sendNote.disabled = submit.disabled || !note.value.trim();
}

async function uploadItems(items) {
  if (form.hidden || submit.disabled || navigating) return;
  const uploadFolder = folderCode;
  setUploadBusy(true);
  const feedback = createUploadFeedback($("inbox-progress"), translate);
  clearLocalizedValue(status);
  status.textContent = "";
  let completed = 0;
  let index = 0;
  let created = 0;
  const failures = [];
  const ensurePath = uploadDirectories(uploadFolder, async (name, target) => {
    const code = await createFolder(name, target);
    created += 1;
    return code;
  });
  try {
    items = await items;
    const total = items.filter(item => item.file).length;
    for (const { file, path } of items) {
      try {
        if (!file) {
          await ensurePath(path);
          continue;
        }
        const position = index++;
        if (!file.size || file.size > maxUploadMiB * 1024 * 1024) {
          throw new Error(translate("文件必须大于 0 字节且不超过 {limit} MiB", { limit: maxUploadMiB }));
        }
        const target = await ensurePath(path);
        const update = feedback.progress(file, position, total);
        await uploadFile(folderQuery({ name: file.name }, target), file, {}, update, translate);
        completed += 1;
      } catch (error) {
        failures.push([...path, ...(file ? [file.name] : [])].join("/") + " · " + error.message);
        if (error.status === 404) {
          if (folderCode === uploadFolder && !navigating) folderError(error);
          break;
        }
      }
    }
    const summary = [translate("已上传 {done}/{total} 个文件", { done: completed, total })];
    if (created) summary.push(translate("已创建 {count} 个文件夹", { count: created }));
    clearLocalizedValue(status);
    status.textContent = [...summary, ...failures].join("\n");
    feedback.finish([...summary, ...failures.slice(0, 1)].join("\n"), failures.length > 0);
    if ((completed || created) && !form.hidden && !navigating) await loadFolder().catch(folderError);
  } catch (error) {
    feedback.finish(error.message, true);
    folderError(error);
  } finally {
    input.value = directoryInput.value = "";
    feedback.close();
    setUploadBusy(false);
  }
  return completed;
}

note.addEventListener("input", updateSendNote);
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (sendNote.disabled || form.hidden || navigating) return;
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const file = new File([note.value], timestamp + ".txt", { type: "text/plain" });
  if (await uploadItems([{ file, path: [] }])) {
    note.value = "";
    updateSendNote();
  }
});

function uploadFiles(files) {
  if (files.length) void uploadItems(files.map(file => ({ file, path: [] })));
}

const uploadOptions = $("inbox-upload-options");
const uploadTrigger = uploadOptions.querySelector("summary");
function openUploadPicker(picker) {
  uploadOptions.open = false;
  uploadTrigger.focus();
  picker.click();
}
document.addEventListener("click", event => {
  if (!uploadOptions.contains(event.target)) uploadOptions.open = false;
  const pathMenu = $("inbox-path").querySelector("details[open]");
  if (pathMenu && (!pathMenu.contains(event.target) || event.target.closest("a"))) pathMenu.open = false;
});
$("inbox-path").addEventListener("keydown", event => {
  const menu = event.target.closest(".inbox-path-menu[open]");
  if (!menu || event.key !== "Escape") return;
  menu.open = false;
  menu.querySelector("summary").focus();
});
uploadOptions.addEventListener("keydown", event => {
  if (event.key !== "Escape" || !uploadOptions.open) return;
  uploadOptions.open = false;
  uploadTrigger.focus();
});
submit.addEventListener("click", () => openUploadPicker(input));
input.addEventListener("change", () => uploadFiles(Array.from(input.files)));
chooseDirectory.hidden = !("webkitdirectory" in directoryInput);
chooseDirectory.addEventListener("click", () => openUploadPicker(directoryInput));
directoryInput.addEventListener("change", () => {
  const items = selectedDirectoryItems(directoryInput.files);
  if (items.length) void uploadItems(items);
});
mkdir.addEventListener("click", async () => {
  if (navigating) return;
  const name = prompt(translate("文件夹名称"))?.trim();
  if (!name) return;
  setUploadBusy(true);
  try {
    await createFolder(name);
    localizeValue(status, () => translate("已创建文件夹「{name}」", { name }));
    await loadFolder();
  } catch (error) {
    folderError(error);
  } finally {
    setUploadBusy(false);
  }
});
document.addEventListener("paste", (event) => {
  if (form.hidden || $("inbox-preview").open) return;
  const files = pastedFiles(event);
  if (!files.length) return;
  event.preventDefault();
  void uploadFiles(files);
});

function isFileDrag(event) {
  return event.dataTransfer?.types.includes("Files");
}

window.addEventListener("dragover", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  const ready = !form.hidden && !submit.disabled && !$("inbox-preview").open;
  event.dataTransfer.dropEffect = ready ? "copy" : "none";
  form.classList.toggle("inbox-dragging", ready);
});
window.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) form.classList.remove("inbox-dragging");
});
window.addEventListener("drop", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  form.classList.remove("inbox-dragging");
  if (!form.hidden && !submit.disabled && !$("inbox-preview").open) {
    void uploadItems(droppedItems(event.dataTransfer));
  }
});

function applyFilters() {
  clearTimeout(searchTimer);
  if (navigating || submit.disabled || form.hidden) return;
  loadFolder(folderCode, 0, undefined, {
    query: $("inbox-query").value.trim(), fileType: $("inbox-type").value, sort: sortSelect.value
  }).catch(folderError);
}

$("inbox-search").addEventListener("submit", event => {
  event.preventDefault();
  applyFilters();
});
function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFilters, 250);
}
$("inbox-query").addEventListener("input", event => {
  if (!event.isComposing) scheduleSearch();
});
$("inbox-query").addEventListener("compositionstart", () => clearTimeout(searchTimer));
$("inbox-query").addEventListener("compositionend", scheduleSearch);
$("inbox-type").addEventListener("change", applyFilters);
sortSelect.addEventListener("change", applyFilters);

async function loadMore() {
  if (!hasMore) return;
  await loadFolder(folderCode, page + 1).catch(folderError);
}
moreRetry.addEventListener("click", loadMore);

const startError = $("inbox-start-error");
const startMessage = $("inbox-start-message");
const retry = $("inbox-retry");

async function openSharedFolder() {
  startError.hidden = true;
  try {
    await loadFolder();
    panel.hidden = false;
  } catch (error) {
    startMessage.textContent = error.message;
    retry.hidden = error.status === 404;
    startError.hidden = false;
  }
}

retry.addEventListener("click", openSharedFolder);
if (folderCode) {
  void openSharedFolder();
} else {
  localizeValue(startMessage, () => translate("公开文件夹链接已失效，请索取新的短链接。"));
  retry.hidden = true;
  startError.hidden = false;
}
