const menu = document.querySelector(".notification-menu");

document.addEventListener("click", event => {
  if (menu?.open && !menu.contains(event.target)) menu.open = false;
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || !menu?.open || document.querySelector("dialog[open]")) return;
  menu.open = false;
  menu.querySelector("summary").focus();
});
