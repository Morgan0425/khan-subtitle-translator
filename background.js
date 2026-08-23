"use strict";

// YouTube captions live in a cross-origin iframe. Relay only the small,
// well-defined caption message to the top-level Khan Academy content script.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.id) {
    return;
  }

  if (
    message?.type === "KST_YOUTUBE_CAPTION" &&
    typeof message.text === "string" &&
    /^https:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\//.test(
      sender.url || "",
    )
  ) {
    const text = message.text.slice(0, 1000);
    chrome.tabs
      .sendMessage(
        sender.tab.id,
        { type: "KST_CAPTION", text, sourceFrameId: sender.frameId },
        { frameId: 0 },
      )
      .catch(() => {
        // The top-level page may be navigating or may not be Khan Academy.
      });
    return;
  }

  if (
    message?.type === "KST_RENDER_CAPTION" &&
    Number.isInteger(message.frameId) &&
    message.frameId > 0 &&
    /^https:\/\/([^.]+\.)?khanacademy\.org\//.test(sender.url || "")
  ) {
    chrome.tabs
      .sendMessage(
        sender.tab.id,
        {
          type: "KST_PLAYER_RENDER",
          enabled: Boolean(message.enabled),
          mode: ["bilingual", "translated", "original"].includes(message.mode)
            ? message.mode
            : "bilingual",
          original:
            typeof message.original === "string"
              ? message.original.slice(0, 1000)
              : "",
          translated:
            typeof message.translated === "string"
              ? message.translated.slice(0, 1000)
              : "",
        },
        { frameId: message.frameId },
      )
      .catch(() => {
        // The player may have been replaced during single-page navigation.
      });
  }
});
