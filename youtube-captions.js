"use strict";

(() => {
  if (window.top === window) {
    return;
  }

  const DEFAULTS = { enabled: false };
  let enabled = false;
  let lastText = "";
  let scanTimer = 0;
  let captionRetryTimer = 0;

  const style = document.createElement("style");
  style.textContent = `
    body.kst-captions-active .caption-window {
      opacity: 0 !important;
    }
    .kst-youtube-overlay {
      position: absolute;
      z-index: 2147483647;
      left: 3%;
      right: 3%;
      bottom: 14%;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 5px;
      text-align: center;
      font-family: Roboto, Arial, sans-serif;
    }
    .kst-youtube-overlay[hidden],
    .kst-youtube-caption[hidden] {
      display: none !important;
    }
    .kst-youtube-caption {
      max-width: 94%;
      padding: 4px 9px;
      border-radius: 5px;
      background: rgba(8, 14, 25, 0.82);
      color: #fff;
      font-size: clamp(16px, 3vw, 28px);
      font-weight: 600;
      line-height: 1.35;
      text-shadow: 0 1px 2px #000;
    }
    .kst-youtube-caption--translated {
      color: #ffe66d;
    }
  `;
  document.documentElement.append(style);

  const overlay = document.createElement("div");
  overlay.className = "kst-youtube-overlay";
  overlay.hidden = true;
  const originalLine = document.createElement("div");
  originalLine.className = "kst-youtube-caption kst-youtube-caption--original";
  const translatedLine = document.createElement("div");
  translatedLine.className =
    "kst-youtube-caption kst-youtube-caption--translated";
  overlay.append(originalLine, translatedLine);
  document.documentElement.append(overlay);

  function normalizeCaption(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function visibleCaptionText() {
    const windows = [...document.querySelectorAll(".caption-window")].filter(
      (node) => {
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      },
    );

    return normalizeCaption(
      windows
        .map((windowNode) =>
          [...windowNode.querySelectorAll(".ytp-caption-segment")]
            .map((segment) => segment.textContent || "")
            .join(" "),
        )
        .join(" "),
    );
  }

  function relayCaption() {
    scanTimer = 0;
    if (!enabled) {
      return;
    }

    const text = visibleCaptionText();
    if (text === lastText) {
      return;
    }

    lastText = text;
    chrome.runtime
      .sendMessage({ type: "KST_YOUTUBE_CAPTION", text })
      .catch(() => {});
  }

  function scheduleScan() {
    if (scanTimer) {
      clearTimeout(scanTimer);
    }
    scanTimer = window.setTimeout(relayCaption, 60);
  }

  function turnCaptionsOn() {
    const button = document.querySelector(".ytp-subtitles-button");
    if (button && button.getAttribute("aria-pressed") !== "true") {
      button.click();
    }
  }

  function startCaptionRetry() {
    window.clearInterval(captionRetryTimer);
    captionRetryTimer = window.setInterval(() => {
      if (enabled) turnCaptionsOn();
    }, 1200);
  }

  function applyEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    document.body?.classList.toggle("kst-captions-active", enabled);
    if (enabled) {
      turnCaptionsOn();
      startCaptionRetry();
      scheduleScan();
    } else if (lastText) {
      window.clearInterval(captionRetryTimer);
      lastText = "";
      overlay.hidden = true;
      chrome.runtime
        .sendMessage({ type: "KST_YOUTUBE_CAPTION", text: "" })
        .catch(() => {});
    } else {
      window.clearInterval(captionRetryTimer);
      overlay.hidden = true;
    }
  }

  const observer = new MutationObserver((mutations) => {
    if (!enabled) {
      return;
    }

    const captionsChanged = mutations.some((mutation) => {
      const target =
        mutation.target instanceof Element
          ? mutation.target
          : mutation.target.parentElement;
      return (
        target &&
        (target.matches(".caption-window, .ytp-caption-segment") ||
          target.closest(".caption-window"))
      );
    });

    if (captionsChanged) {
      scheduleScan();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  chrome.storage.local.get(DEFAULTS).then((settings) => {
    applyEnabled(settings.enabled);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.enabled) {
      applyEnabled(changes.enabled.newValue);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "KST_PLAYER_RENDER") return;

    const original = normalizeCaption(message.original || "");
    const translated = normalizeCaption(message.translated || "");
    const mode = message.mode || "bilingual";
    overlay.hidden = !message.enabled || !original;
    originalLine.textContent = original;
    translatedLine.textContent = translated || "正在翻译…";
    originalLine.hidden = mode === "translated";
    translatedLine.hidden = mode === "original";
  });
})();
