import { isDocumentPreview, previewType } from "./media-types.js";
import { entryExtension, formatEntryKind, formatEntrySize } from "./entry-format.js";
import { clearLocalizedValue, localizeValue } from "./drive-i18n.js";

export function createMediaPreview(dialog, { load, download, address, openTab, translate }) {
  const title = dialog.querySelector("h2");
  const details = dialog.querySelector(".media-details");
  const counter = dialog.querySelector(".media-position");
  const status = dialog.querySelector("#preview-status");
  const content = dialog.querySelector("#preview-content");
  const previous = dialog.querySelector("[data-previous]");
  const next = dialog.querySelector("[data-next]");
  const openFull = dialog.querySelector("[data-preview-full]");
  let items = [];
  let index = 0;
  let request;
  let url;

  function clear() {
    request?.abort();
    content.replaceChildren();
    if (url) URL.revokeObjectURL(url);
    url = undefined;
  }

  async function show(position) {
    if (position < 0 || position >= items.length) return;
    index = position;
    clear();
    const controller = new AbortController();
    request = controller;
    const { item, type } = items[index];
    const extension = entryExtension(item.name);
    title.textContent = extension
      ? item.name.slice(0, -extension.length - 1) + " " + extension.toUpperCase()
      : item.name;
    title.title = item.name;
    localizeValue(details, () => [translate(formatEntryKind(item)), Number.isFinite(item.size) ? formatEntrySize(item.size) : ""]
      .filter(Boolean).join(" · "));
    counter.textContent = (index + 1) + " / " + items.length;
    previous.disabled = index === 0;
    next.disabled = index === items.length - 1;
    openFull.hidden = !type;
    localizeValue(status, () => translate("正在加载预览…"));
    if (!dialog.open) dialog.showModal();
    if (!type) {
      localizeValue(status, () => translate("浏览器无法预览此文件，请下载后打开。"));
      return;
    }
    try {
      if (isDocumentPreview(type) || /^(audio|video)\//.test(type)) {
        const frame = document.createElement("iframe");
        frame.title = item.name;
        frame.addEventListener("load", () => {
          if (controller.signal.aborted) return;
          clearLocalizedValue(status);
          status.textContent = "";
        });
        frame.src = address(item);
        content.append(frame);
        return;
      }
      const blob = await load(item, type, controller.signal);
      if (controller.signal.aborted || !dialog.open) return;
      const media = document.createElement("img");
      media.alt = item.name;
      media.addEventListener("load", () => {
        if (!controller.signal.aborted) {
          clearLocalizedValue(status);
          status.textContent = "";
        }
      });
      media.addEventListener("error", () => {
        if (!controller.signal.aborted) localizeValue(status, () => translate("浏览器无法预览此文件，请下载后打开。"));
      });
      url = URL.createObjectURL(blob.slice(0, blob.size, type));
      media.src = url;
      content.append(media);
    } catch (error) {
      if (!controller.signal.aborted) {
        clearLocalizedValue(status);
        status.textContent = error.message;
      }
    }
  }

  previous.addEventListener("click", () => show(index - 1));
  next.addEventListener("click", () => show(index + 1));
  dialog.querySelector("[data-preview-close]").addEventListener("click", () => dialog.close());
  openFull.addEventListener("click", () => {
    const { item, type } = items[index];
    if (!type) return;
    try {
      openTab(item);
    } catch (error) {
      clearLocalizedValue(status);
      status.textContent = error.message;
    }
  });
  dialog.querySelector("[data-preview-download]").addEventListener("click", async () => {
    const selected = items[index];
    const current = request;
    try {
      await download(selected.item);
    } catch (error) {
      if (dialog.open && current === request) {
        clearLocalizedValue(status);
        status.textContent = error.message;
      }
    }
  });
  dialog.addEventListener("close", () => { if (!dialog.open) clear(); });
  document.addEventListener("keydown", (event) => {
    if (!dialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
    if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      show(index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1));
    }
  });

  return (selected, entries) => {
    items = entries.filter(item => item.kind !== "folder").map(item => ({ item, type: previewType(item) }));
    return show(items.findIndex(({ item }) => item.id === selected.id));
  };
}
