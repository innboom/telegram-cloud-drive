import { localizeValue, translate } from "./drive-i18n.js";

export function bindShareMenu(panel, copyShare, status) {
  let shareLink;

  function closeShareMenu(restoreFocus = false) {
    const link = shareLink;
    shareLink = null;
    copyShare.hidden = true;
    if (restoreFocus && link?.isConnected) link.focus({ preventScroll: true });
  }

  panel.addEventListener("contextmenu", event => {
    const link = event.target.closest("a[data-folder-link]") ??
      event.target.closest(".inbox-grid > li")?.querySelector(".inbox-tile");
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

  return closeShareMenu;
}
