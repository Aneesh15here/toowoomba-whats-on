const root = document.documentElement;
const button = document.querySelector("#theme-toggle");
const themeColor = document.querySelector('meta[name="theme-color"]');

function explicitTheme() {
  const value = root.dataset.theme;
  if (value === "dark" || value === "light") return value;
  return null;
}

function systemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function currentTheme() {
  return explicitTheme() || systemTheme();
}

function paintTheme(theme) {
  const dark = theme === "dark";
  if (button) {
    button.setAttribute("aria-pressed", String(dark));
    button.textContent = dark ? "Light" : "Dark";
    button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  if (themeColor) themeColor.setAttribute("content", dark ? "#171410" : "#fff6ee");
}

function storeTheme(theme) {
  root.dataset.theme = theme;
  try {
    localStorage.setItem("wot-theme", theme);
  } catch {
    // Private mode can block storage. The choice still applies for this view.
  }
}

button?.addEventListener("click", () => {
  storeTheme(currentTheme() === "dark" ? "light" : "dark");
  paintTheme(currentTheme());
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!explicitTheme()) paintTheme(currentTheme());
});

paintTheme(currentTheme());
