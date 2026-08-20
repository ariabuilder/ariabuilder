(function () {
  try {
    var raw = localStorage.getItem("aria-appearance");
    if (!raw) return;
    var prefs = JSON.parse(raw);
    var html = document.documentElement;
    var themeId =
      prefs &&
      (prefs.themeId === "aria" ||
        prefs.themeId === "orbital" ||
        prefs.themeId === "signal")
        ? prefs.themeId
        : "aria";
    var scheme =
      prefs &&
      (prefs.colorScheme === "light" ||
        prefs.colorScheme === "dark" ||
        prefs.colorScheme === "system")
        ? prefs.colorScheme
        : "system";
    var isDark =
      scheme === "dark" ||
      (scheme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    html.classList.remove("theme-orbital", "theme-signal", "dark");
    if (themeId === "orbital" || themeId === "signal") {
      html.classList.add("theme-" + themeId);
    }
    html.setAttribute("data-theme", themeId);
    if (isDark) html.classList.add("dark");
    if (prefs && typeof prefs.uiZoom === "number") {
      html.style.setProperty("--ui-zoom", String(prefs.uiZoom));
    }
  } catch (_) {}
})();
