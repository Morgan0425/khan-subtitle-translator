"use strict";

(() => {
  if (window.top !== window || document.getElementById("kst-launcher")) {
    return;
  }

  const DEFAULTS = {
    enabled: false,
    mode: "bilingual",
    targetLanguage: "zh",
  };

  const LANGUAGE_LABELS = {
    zh: "简体中文",
    "zh-Hant": "繁體中文",
    ja: "日本語",
    ko: "한국어",
    es: "Español",
    fr: "Français",
    de: "Deutsch",
  };

  const state = {
    settings: { ...DEFAULTS },
    translator: null,
    translatorTarget: "",
    translatorPromise: null,
    translatorPromiseTarget: "",
    translatorGeneration: 0,
    currentOriginal: "",
    currentTranslation: "",
    requestId: 0,
    statusTimer: 0,
    directTrack: null,
    sourceFrameId: 0,
  };

  const cache = new Map();

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  const launcher = createElement("button", "kst-launcher", "译");
  launcher.id = "kst-launcher";
  launcher.type = "button";
  launcher.title = "可汗双语字幕";
  launcher.setAttribute("aria-label", "打开可汗双语字幕设置");

  const panel = createElement("section", "kst-panel");
  panel.id = "kst-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "可汗双语字幕设置");

  const panelHeader = createElement("div", "kst-panel__header");
  panelHeader.append(
    createElement("strong", "kst-panel__title", "可汗双语字幕"),
    createElement("span", "kst-local-badge", "本地翻译"),
  );

  const enableRow = createElement("label", "kst-row kst-row--switch");
  const enableText = createElement("span", "", "启用字幕翻译");
  const enableToggle = createElement("input");
  enableToggle.type = "checkbox";
  enableToggle.id = "kst-enabled";
  enableRow.append(enableText, enableToggle);

  const modeLabel = createElement("label", "kst-field");
  modeLabel.append(createElement("span", "", "显示方式"));
  const modeSelect = createElement("select");
  modeSelect.id = "kst-mode";
  [
    ["bilingual", "双语"],
    ["translated", "仅译文"],
    ["original", "仅原文"],
  ].forEach(([value, label]) => {
    const option = createElement("option", "", label);
    option.value = value;
    modeSelect.append(option);
  });
  modeLabel.append(modeSelect);

  const languageLabel = createElement("label", "kst-field");
  languageLabel.append(createElement("span", "", "目标语言"));
  const languageSelect = createElement("select");
  languageSelect.id = "kst-language";
  Object.entries(LANGUAGE_LABELS).forEach(([value, label]) => {
    const option = createElement("option", "", label);
    option.value = value;
    languageSelect.append(option);
  });
  languageLabel.append(languageSelect);

  const status = createElement(
    "div",
    "kst-status",
    "打开视频后启用，扩展会自动开启英文 CC。",
  );
  status.id = "kst-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const privacy = createElement(
    "p",
    "kst-privacy",
    "翻译在 Chrome 本机完成，字幕不会发送到云端。",
  );

  panel.append(panelHeader, enableRow, modeLabel, languageLabel, status, privacy);

  const overlay = createElement("div", "kst-overlay");
  overlay.id = "kst-overlay";
  overlay.hidden = true;
  overlay.setAttribute("aria-live", "off");
  const originalLine = createElement("div", "kst-caption kst-caption--original");
  const translatedLine = createElement(
    "div",
    "kst-caption kst-caption--translated",
  );
  overlay.append(originalLine, translatedLine);

  document.documentElement.append(launcher, panel, overlay);

  function setStatus(message, kind = "info", sticky = false) {
    status.textContent = message;
    status.dataset.kind = kind;
    window.clearTimeout(state.statusTimer);
    if (!sticky) {
      state.statusTimer = window.setTimeout(() => {
        status.textContent = state.settings.enabled
          ? "等待视频字幕…"
          : "翻译已关闭。";
        status.dataset.kind = "info";
      }, 4500);
    }
  }

  function setLauncherState() {
    launcher.classList.toggle("kst-launcher--enabled", state.settings.enabled);
    launcher.textContent = state.settings.enabled ? "译中" : "译";
    launcher.title = state.settings.enabled
      ? "字幕翻译已开启"
      : "打开可汗双语字幕";
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  function render() {
    const hasCaption = Boolean(state.currentOriginal);
    overlay.hidden =
      !state.settings.enabled || !hasCaption || state.sourceFrameId > 0;
    originalLine.textContent = state.currentOriginal;
    translatedLine.textContent = state.currentTranslation || "正在翻译…";

    originalLine.hidden = state.settings.mode === "translated";
    translatedLine.hidden = state.settings.mode === "original";
    renderInYouTubeFrame();
    positionOverlay();
  }

  function renderInYouTubeFrame() {
    if (state.sourceFrameId <= 0) return;
    chrome.runtime
      .sendMessage({
        type: "KST_RENDER_CAPTION",
        frameId: state.sourceFrameId,
        enabled: state.settings.enabled,
        mode: state.settings.mode,
        original: state.currentOriginal,
        translated: state.currentTranslation,
      })
      .catch(() => {});
  }

  function findPlayer() {
    const candidates = [
      ...document.querySelectorAll(
        'iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com/embed"], iframe[title*="YouTube"], video',
      ),
    ];

    return (
      candidates
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 280 && rect.height > 150;
        })
        .sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          return br.width * br.height - ar.width * ar.height;
        })[0] || null
    );
  }

  function positionOverlay() {
    if (overlay.hidden) return;
    const player = findPlayer();
    if (!player) {
      overlay.hidden = true;
      return;
    }

    const rect = player.getBoundingClientRect();
    const inset = Math.max(58, Math.min(96, rect.height * 0.14));
    overlay.style.left = `${Math.max(12, rect.left + 12)}px`;
    overlay.style.width = `${Math.max(240, rect.width - 24)}px`;
    overlay.style.bottom = `${Math.max(12, window.innerHeight - rect.bottom + inset)}px`;
    overlay.classList.toggle(
      "kst-overlay--outside",
      rect.bottom < 0 || rect.top > window.innerHeight,
    );
  }

  function disposeTranslator() {
    state.translatorGeneration += 1;
    if (state.translator?.destroy) {
      state.translator.destroy();
    }
    state.translator = null;
    state.translatorTarget = "";
    state.translatorPromise = null;
    state.translatorPromiseTarget = "";
  }

  function ensureTranslator(fromUserGesture = false) {
    if (
      state.translator &&
      state.translatorTarget === state.settings.targetLanguage
    ) {
      return Promise.resolve(state.translator);
    }

    if (
      state.translatorPromise &&
      state.translatorPromiseTarget === state.settings.targetLanguage
    ) {
      return state.translatorPromise;
    }

    if (!("Translator" in self)) {
      return Promise.reject(new Error("UNSUPPORTED"));
    }

    disposeTranslator();
    const generation = state.translatorGeneration;
    const targetLanguage = state.settings.targetLanguage;
    const options = {
      sourceLanguage: "en",
      targetLanguage,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          setStatus(
            `首次使用：正在下载本地语言包 ${Math.round(event.loaded * 100)}%`,
            "progress",
            true,
          );
        });
      },
    };

    let creationPromise;
    if (fromUserGesture) {
      // Call create() in the user event itself. Chrome requires this when a
      // language pack needs to be downloaded for the first time.
      setStatus("正在准备本地翻译模型…", "progress", true);
      creationPromise = self.Translator.create(options);
    } else {
      creationPromise = (async () => {
        const availability = await self.Translator.availability(options);
        if (availability === "unavailable") {
          throw new Error("LANGUAGE_UNAVAILABLE");
        }
        if (availability === "downloadable") {
          throw new Error("ACTIVATION_REQUIRED");
        }
        setStatus("正在启动本地翻译…", "progress", true);
        return self.Translator.create(options);
      })();
    }

    const pending = Promise.resolve(creationPromise)
      .then((translator) => {
        if (
          generation !== state.translatorGeneration ||
          targetLanguage !== state.settings.targetLanguage
        ) {
          translator.destroy?.();
          throw new Error("STALE_TRANSLATOR");
        }
        state.translator = translator;
        state.translatorTarget = targetLanguage;
        setStatus("本地翻译已就绪，请播放视频。", "success");
        return translator;
      })
      .finally(() => {
        if (state.translatorPromise === pending) {
          state.translatorPromise = null;
          state.translatorPromiseTarget = "";
        }
      });

    state.translatorPromise = pending;
    state.translatorPromiseTarget = targetLanguage;
    return pending;
  }

  function friendlyError(error) {
    if (error?.message === "UNSUPPORTED") {
      return "需要桌面版 Chrome 138 或更高版本。";
    }
    if (error?.message === "LANGUAGE_UNAVAILABLE") {
      return "当前浏览器不支持这组翻译语言。";
    }
    if (
      error?.message === "ACTIVATION_REQUIRED" ||
      error?.name === "NotAllowedError"
    ) {
      return "请点击右侧“译”按钮，再打开启用开关。";
    }
    if (error?.message === "STALE_TRANSLATOR") {
      return "";
    }
    return `翻译启动失败：${error?.message || "未知错误"}`;
  }

  async function translateCaption(text, sourceFrameId = state.sourceFrameId) {
    const normalized = normalizeText(text);
    state.sourceFrameId = sourceFrameId;
    state.currentOriginal = normalized;
    state.currentTranslation = cache.get(normalized) || "";
    const requestId = ++state.requestId;
    render();

    if (!normalized || state.settings.mode === "original") {
      return;
    }
    if (state.currentTranslation) {
      return;
    }

    try {
      const translator = await ensureTranslator(false);
      const translation = normalizeText(await translator.translate(normalized));
      cache.set(normalized, translation);
      if (cache.size > 300) {
        cache.delete(cache.keys().next().value);
      }

      if (requestId === state.requestId && normalized === state.currentOriginal) {
        state.currentTranslation = translation;
        render();
      }
    } catch (error) {
      const message = friendlyError(error);
      if (message) setStatus(message, "error", true);
    }
  }

  function attachDirectTextTrack() {
    if (!state.settings.enabled) return;
    const video = document.querySelector("video");
    if (!video?.textTracks?.length) return;

    const track = [...video.textTracks].find(
      (item) => item.language?.startsWith("en") || item.kind === "captions",
    );
    if (!track || track === state.directTrack) return;

    state.directTrack = track;
    track.mode = "hidden";
    track.addEventListener("cuechange", () => {
      const text = [...(track.activeCues || [])]
        .map((cue) => cue.text || "")
        .join(" ");
      translateCaption(text, 0);
    });
  }

  async function setEnabled(enabled, fromUserGesture = false) {
    state.settings.enabled = Boolean(enabled);
    enableToggle.checked = state.settings.enabled;
    setLauncherState();
    if (!state.settings.enabled) {
      disposeTranslator();
      state.currentOriginal = "";
      state.currentTranslation = "";
      state.requestId += 1;
      render();
      await chrome.storage.local.set({ enabled: false });
      setStatus("翻译已关闭。", "info", true);
      return;
    }

    setStatus("正在启动…", "progress", true);
    const translatorPromise = ensureTranslator(fromUserGesture);
    await chrome.storage.local.set({ enabled: true });
    try {
      await translatorPromise;
      attachDirectTextTrack();
    } catch (error) {
      const message = friendlyError(error);
      if (!message) return;
      state.settings.enabled = false;
      enableToggle.checked = false;
      setLauncherState();
      state.currentOriginal = "";
      state.currentTranslation = "";
      render();
      await chrome.storage.local.set({ enabled: false });
      setStatus(message, "error", true);
    }
  }

  launcher.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });

  document.addEventListener("click", (event) => {
    if (
      !panel.hidden &&
      !panel.contains(event.target) &&
      event.target !== launcher
    ) {
      panel.hidden = true;
    }
  });

  enableToggle.addEventListener("change", () => {
    setEnabled(enableToggle.checked, true);
  });

  modeSelect.addEventListener("change", async () => {
    state.settings.mode = modeSelect.value;
    await chrome.storage.local.set({ mode: state.settings.mode });
    render();
    if (
      state.settings.enabled &&
      state.settings.mode !== "original" &&
      state.currentOriginal &&
      !state.currentTranslation
    ) {
      translateCaption(state.currentOriginal);
    }
  });

  languageSelect.addEventListener("change", async () => {
    state.settings.targetLanguage = languageSelect.value;
    state.currentTranslation = "";
    cache.clear();
    const translatorPromise = state.settings.enabled
      ? ensureTranslator(true)
      : null;
    await chrome.storage.local.set({
      targetLanguage: state.settings.targetLanguage,
    });

    if (state.settings.enabled) {
      try {
        await translatorPromise;
        if (state.currentOriginal) {
          translateCaption(state.currentOriginal);
        }
      } catch (error) {
        const message = friendlyError(error);
        if (message) setStatus(message, "error", true);
      }
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "KST_CAPTION" && state.settings.enabled) {
      translateCaption(message.text, message.sourceFrameId || 0);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.mode) {
      state.settings.mode = changes.mode.newValue || DEFAULTS.mode;
      modeSelect.value = state.settings.mode;
      render();
    }
  });

  window.addEventListener("resize", positionOverlay, { passive: true });
  window.addEventListener("scroll", positionOverlay, { passive: true });
  window.setInterval(() => {
    if (state.settings.enabled) {
      positionOverlay();
      attachDirectTextTrack();
    }
  }, 1000);

  chrome.storage.local.get(DEFAULTS).then((settings) => {
    state.settings = { ...DEFAULTS, ...settings };
    enableToggle.checked = state.settings.enabled;
    modeSelect.value = state.settings.mode;
    languageSelect.value = state.settings.targetLanguage;
    setLauncherState();

    if (state.settings.enabled) {
      setStatus("点击开关关闭再开启，以激活本地翻译。", "info", true);
      ensureTranslator(false)
        .then(() => attachDirectTextTrack())
        .catch((error) => {
          const message = friendlyError(error);
          if (message) setStatus(message, "error", true);
        });
    }
  });
})();
