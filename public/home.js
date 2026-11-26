import { fileIcon } from "./file-icons.js";
import { previewType } from "./media-types.js";
import { localizeDrive, localizeValue, translate } from "./drive-i18n.js";
import { bindShareMenu } from "./share-menu.js";

const $ = id => document.getElementById(id);
localizeDrive();
const list = $("public-shares");
const status = $("public-shares-status");
const more = $("public-shares-more");
let offset = 0;

bindShareMenu(list, $("public-copy-share"), $("public-copy-status"));

function renderShare(item) {
  const row = document.createElement("li");
  const link = document.createElement("a");
  link.className = "inbox-tile";
  link.href = "/s/" + item.share_code;
  link.title = item.name;
  const art = document.createElement("span");
  art.className = "inbox-art";
  art.setAttribute("aria-hidden", "true");
  const icon = document.createElement("span");
  const folder = item.kind === "folder";
  icon.className = folder ? "inbox-icon icon-folder" : "inbox-icon inbox-file-art";
  if (!folder) icon.append(fileIcon(item.name, previewType(item)));
  art.append(icon);
  const name = document.createElement("span");
  name.className = "inbox-name";
  name.textContent = item.name;
  link.append(art, name);
  row.append(link);
  return row;
}

async function loadShares() {
  more.disabled = true;
  status.hidden = offset > 0;
  if (!status.hidden) localizeValue(status, () => translate("正在加载公开分享…"));
  try {
    const response = await fetch("/api/public-shares?offset=" + offset, { credentials: "omit" });
    if (!response.ok) throw new Error();
    const { entries, hasMore } = await response.json();
    list.append(...entries.map(renderShare));
    offset += entries.length;
    status.hidden = offset > 0;
    if (offset === 0) {
      localizeValue(status, () => translate("暂无公开链接。"));
    }
    localizeValue(more, () => translate("加载更多"));
    more.hidden = !hasMore;
  } catch {
    localizeValue(status, () => translate("请求失败，请稍后重试。"));
    localizeValue(more, () => translate("重试"));
    status.hidden = more.hidden = false;
  } finally {
    more.disabled = false;
  }
}

async function loadConfig() {
  const response = await fetch("/api/config", { credentials: "omit" });
  if (!response.ok) return;
  const { title, description } = await response.json();
  const siteTitle = () => title === "云盘" ? translate("云盘") : title;
  localizeValue($("title"), siteTitle);
  localizeValue(document.querySelector("title"), siteTitle);
  $("description").textContent = description;
  $("description").hidden = !description;
}

more.addEventListener("click", loadShares);
void loadShares();
void loadConfig().catch(() => {});
