async function updateMaximizeButton(electronAPI) {
  const maximizeButton = document.getElementById("maximize-btn");
  if (!maximizeButton || !electronAPI?.isMaximized) return;

  try {
    const isMaximized = await electronAPI.isMaximized();
    const image = maximizeButton.querySelector("img");
    if (!image) return;

    maximizeButton.classList.toggle("maximized", isMaximized);
    image.src = isMaximized
      ? "icons/window-restore.png"
      : "icons/window-maximize.png";
    image.alt = isMaximized ? "Restore Down" : "Maximize";
    maximizeButton.title = image.alt;
  } catch (error) {
    console.error("Error checking maximize state:", error);
  }
}

export function initializeWindowControls(electronAPI = window.electronAPI) {
  document.getElementById("minimize-btn")?.addEventListener("click", () => {
    electronAPI.minimizeWindow();
  });

  document.getElementById("maximize-btn")?.addEventListener("click", async () => {
    await electronAPI.maximizeWindow();
    await updateMaximizeButton(electronAPI);
  });

  document.getElementById("close-btn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    try {
      electronAPI.closeWindow();
    } catch (error) {
      console.error("Failed to close window via electronAPI:", error);
    }
  });

  updateMaximizeButton(electronAPI);
  window.addEventListener("resize", () => {
    window.setTimeout(() => updateMaximizeButton(electronAPI), 100);
  });
}
