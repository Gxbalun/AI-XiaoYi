(() => {
const CONTENT_VERSION = "1.2.0";
if (window.__MODEL_TRANSLATOR_CONTENT_VERSION__ === CONTENT_VERSION) {
  return;
}
if (window.__MODEL_TRANSLATOR_CONTENT_VERSION__) {
  [
    "model-translator-selection-button-v2",
    "model-translator-popover-v2",
    "model-translator-word-popover-v2",
    "model-translator-floating-host-v2",
    "model-translator-floating-glass-v2",
    "model-translator-floating-glass-definitions-v2"
  ].forEach((id) => document.getElementById(id)?.remove());
}
window.__MODEL_TRANSLATOR_CONTENT_LOADED__ = true;
window.__MODEL_TRANSLATOR_CONTENT_VERSION__ = CONTENT_VERSION;

const BUTTON_ID = "model-translator-selection-button-v2";
const POPOVER_ID = "model-translator-popover-v2";
const WORD_POPOVER_ID = "model-translator-word-popover-v2";
const FLOATING_HOST_ID = "model-translator-floating-host-v2";
const FLOATING_GLASS_ID = "model-translator-floating-glass-v2";
const FLOATING_GLASS_DEFINITIONS_ID = "model-translator-floating-glass-definitions-v2";
const FLOATING_POSITION_KEY = "floatingButtonPosition";
const FLOATING_PANEL_PREFERENCES_KEY = "floatingPanelPreferences";
const PAGE_DISPLAY_MODE_KEY = "pageTranslationDisplayMode";
const ASSISTANT_IDLE_ICON_PATH = "icons/assistant-idle.svg";
const ASSISTANT_TRANSLATING_ICON_PATH = "icons/assistant-translating.svg";
const SELECTION_IDLE_ICON_PATH = "icons/selection-idle.svg";
const SELECTION_TRANSLATING_ICON_PATH = "icons/selection-translating.svg";
const PANEL_OPACITY_MIN = 30;
const PANEL_OPACITY_MID = 70;
const PANEL_OPACITY_MAX = 100;
const ASSISTANT_MODE_ENABLED_KEY = "assistantModeEnabled";
const ASSISTANT_MODE_PAUSED_UNTIL_KEY = "assistantModePausedUntil";
const SELECTION_TRANSLATION_ENABLED_KEY = "selectionTranslationEnabled";
const ASSISTANT_MODE_PAUSE_MS = 30 * 60 * 1000;
const DEFAULT_SETTINGS = {
  baseUrl: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4o-mini",
  targetLanguage: "中文"
};
const SELF_TARGET_LANGUAGES = [
  ["自动（中英互译）", "自动(中英)"],
  ["中文", "中文"],
  ["繁体中文", "繁体中文"],
  ["英文", "英文"],
  ["日文", "日文"],
  ["韩文", "韩文"],
  ["法文", "法文"],
  ["德文", "德文"],
  ["西班牙文", "西班牙文"],
  ["葡萄牙文", "葡萄牙文"],
  ["意大利文", "意大利文"],
  ["俄文", "俄文"],
  ["阿拉伯文", "阿拉伯文"],
  ["泰文", "泰文"],
  ["越南文", "越南文"]
];
const SELF_SOURCE_LANGUAGES = [
  ["自动识别", "自动识别"],
  ...SELF_TARGET_LANGUAGES.filter(([value]) => value !== "自动（中英互译）")
];
const PAGE_LIMIT = 140;
const PAGE_BATCH_SIZE = 24;
const PAGE_BATCH_CONCURRENCY = 4;
const PAGE_BATCH_RETRY_LIMIT = 2;
const PAGE_BATCH_RETRY_BASE_DELAY_MS = 700;
const PAGE_FAILED_NODE_COOLDOWN_MS = 30000;
const PAGE_INTERSECTION_MARGIN = 720;
const PAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_PERSISTENT_CACHE_KEY = "pageTranslationPersistentCacheV2";
const PAGE_PERSISTENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_PERSISTENT_CACHE_MAX = 1200;
const PAGE_CACHE_FLUSH_DELAY_MS = 8000;
const PAGE_CACHE_FLUSH_ENTRY_LIMIT = 160;
const PAGE_CACHE_FLUSH_BYTE_LIMIT = 512 * 1024;
const PAGE_CACHE_PENDING_ENTRY_MAX = 320;
const PAGE_CACHE_PENDING_BYTE_MAX = 1024 * 1024;

let currentSelection = "";
let currentRange = null;
let translatedNodes = [];
let translatedNodeSet = new WeakSet();
let pageTranslationDisplayMode = document.documentElement.dataset.modelTranslatorPageDisplayMode === "bilingual"
  ? "bilingual"
  : "translated";
let pageDisplayPreferenceReady = Promise.resolve();
let pageTranslationRunning = false;
let pageTranslationEnabled = false;
let pageTranslationQueued = false;
let pageTranslationCancelToken = 0;
let pageTranslationRequestId = "";
let pageTranslationForceRefresh = false;
let pageTranslationPaused = false;
let pageTranslationResumeWaiters = new Set();
let pageTranslationFailedEntries = new Map();
let pageTranslationProgress = createPageTranslationProgress();
let pageTranslationProgressKnownNodes = new WeakSet();
let pageLazyTimer = 0;
let pageHoverTimer = 0;
let pageMutationObserver = null;
let pageIntersectionObserver = null;
let pageCandidateScanInitialized = false;
let pageCandidateElements = new Map();
let pageVisibleCandidateNodes = new Set();
let pageTranslationFailureCooldown = new WeakMap();
let pagePersistentCacheLoaded = false;
let pagePersistentCache = {};
let pagePersistentCacheDirtyBytes = 0;
let pagePersistentCacheFlushTimer = 0;
const pagePersistentCacheDirtyEntries = new Map();
const pageTranslationCache = new Map();
const assistantTranslationBusyKeys = new Set();
let selectionTranslationEnabled = true;

document.addEventListener("mouseup", (event) => {
  if (isTranslatorUiTarget(event.target)) return;
  const pointerPosition = { clientX: event.clientX, clientY: event.clientY };
  window.setTimeout(() => handleSelectionChange(pointerPosition), 80);
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const wordPopover = document.getElementById(WORD_POPOVER_ID);
  const clickedWord = event.composedPath().some((node) => node instanceof Element && node.matches(".model-translator-learn-word, .floating-learn-word"));
  const clickedWordPopover = Boolean(target?.closest(`#${WORD_POPOVER_ID}`));
  if (wordPopover && !clickedWord && !clickedWordPopover && wordPopover.dataset.pinned !== "true") {
    removeWordPopover();
  }
  if (isTranslatorUiTarget(event.target)) return;
  if (document.getElementById(POPOVER_ID)) removeSelectionUi();
  if (pageTranslationEnabled) {
    window.setTimeout(scheduleLazyPageTranslation, 220);
  }
});

document.addEventListener("pointerover", (event) => {
  if (!pageTranslationEnabled || isTranslatorUiTarget(event.target)) return;
  window.clearTimeout(pageHoverTimer);
  pageHoverTimer = window.setTimeout(scheduleLazyPageTranslation, 260);
}, true);

document.addEventListener("keyup", (event) => {
  if (document.getElementById(POPOVER_ID)) return;

  if (event.key === "Escape") {
    removeSelectionUi();
  } else {
    handleSelectionChange();
  }
});

document.addEventListener("scroll", () => {
  removeSelectionButton();
  scheduleLazyPageTranslation();
}, true);
document.addEventListener("click", syncPageDisplayModeFromComposedClick, true);
document.addEventListener("fullscreenchange", syncAssistantModeVisibility);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void flushPageTranslationCache();
  }
});
window.addEventListener("pagehide", () => {
  void flushPageTranslationCache();
});

syncAssistantModeVisibility();
syncSelectionTranslationPreference();
pageDisplayPreferenceReady = syncPageTranslationDisplayPreference();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[SELECTION_TRANSLATION_ENABLED_KEY]) {
    applySelectionTranslationPreference(changes[SELECTION_TRANSLATION_ENABLED_KEY].newValue !== false);
  }
  if (
    areaName === "local" &&
    (changes[ASSISTANT_MODE_ENABLED_KEY] || changes[ASSISTANT_MODE_PAUSED_UNTIL_KEY])
  ) {
    syncAssistantModeVisibility();
  }
  if (areaName === "local" && changes[PAGE_DISPLAY_MODE_KEY]) {
    setPageBilingualDisplay(changes[PAGE_DISPLAY_MODE_KEY].newValue === "bilingual", { persist: false });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "translator-ping") {
    sendResponse({ ok: true, version: CONTENT_VERSION });
    return;
  }

  if (message?.type === "page-translate-v2") {
    translateVisiblePage({ waitForRunning: true })
      .then((count) => sendResponse({ ok: true, count }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "page-restore-v2") {
    restorePageText();
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "page-bilingual-toggle-v2") {
    const state = togglePageBilingualDisplay();
    sendResponse({ ok: true, ...state });
    return;
  }

  if (message?.type === "page-display-mode-v2") {
    const state = setPageBilingualDisplay(message.mode === "bilingual");
    sendResponse({ ok: true, ...state });
    return;
  }

  if (message?.type === "page-translation-state-v2") {
    pageDisplayPreferenceReady
      .then(() => sendResponse({ ok: true, translated: translatedNodes.length > 0, bilingual: pageTranslationDisplayMode === "bilingual" }))
      .catch(() => sendResponse({ ok: true, translated: translatedNodes.length > 0, bilingual: pageTranslationDisplayMode === "bilingual" }));
    return true;
  }

  if (message?.type === "assistant-translation-busy-v2") {
    setFloatingAssistantTranslationBusy(message.requestId || "external", message.busy !== false);
    sendResponse({ ok: true });
  }
});

function handleSelectionChange(pointerPosition = null) {
  if (!getExtensionAssetUrl("")) {
    removeSelectionUi();
    return;
  }
  if (!selectionTranslationEnabled) {
    removeSelectionUi();
    return;
  }
  if (document.getElementById(POPOVER_ID)) return;

  const selection = window.getSelection();
  const text = selection?.toString().trim() || "";
  const selectedWord = getSingleEnglishWord(text);

  if (!text || (!selectedWord && text.length < 2) || selection.rangeCount === 0) {
    removeSelectionUi();
    return;
  }

  currentSelection = text;
  currentRange = selection.getRangeAt(0).cloneRange();
  showSelectionButton(currentRange, pointerPosition);
}

function showSelectionButton(range, pointerPosition = null) {
  removeElement(POPOVER_ID);

  const rect = getRangeRect(range);
  const endpoints = getRangeEndpointAnchors(range);
  if (!rect || !endpoints) return;

  let button = document.getElementById(BUTTON_ID);
  if (!button) {
    const idleIconUrl = getExtensionAssetUrl(SELECTION_IDLE_ICON_PATH);
    if (!idleIconUrl) return;
    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.innerHTML = `<img src="${idleIconUrl}" draggable="false" alt="" />`;
    button.title = "翻译选中文本";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", translateSelection);
    document.documentElement.appendChild(button);
  }
  button.title = getSingleEnglishWord(currentSelection) ? "查看单词详情" : "翻译选中文本";
  button.dataset.readyAt = String(Date.now() + 300);

  const buttonSize = 32;
  const pointerGap = 8;
  const viewportGap = 6;
  const hasPointerPosition = Number.isFinite(pointerPosition?.clientX) && Number.isFinite(pointerPosition?.clientY);
  const distanceToStart = hasPointerPosition ? getPointDistance(pointerPosition, endpoints.start) : Number.POSITIVE_INFINITY;
  const distanceToEnd = hasPointerPosition ? getPointDistance(pointerPosition, endpoints.end) : 0;
  const anchor = distanceToStart < distanceToEnd ? endpoints.start : endpoints.end;
  let clientLeft = anchor.side === "left"
    ? anchor.x - buttonSize - pointerGap
    : anchor.x + pointerGap;
  let clientTop = anchor.y - buttonSize / 2;

  if (clientLeft < viewportGap) clientLeft = anchor.x + pointerGap;
  if (clientLeft + buttonSize > window.innerWidth - viewportGap) {
    clientLeft = anchor.x - buttonSize - pointerGap;
  }
  clientLeft = Math.max(viewportGap, Math.min(clientLeft, window.innerWidth - buttonSize - viewportGap));
  clientTop = Math.max(viewportGap, Math.min(clientTop, window.innerHeight - buttonSize - viewportGap));

  Object.assign(button.style, {
    top: `${window.scrollY + clientTop}px`,
    left: `${window.scrollX + clientLeft}px`
  });
}

async function translateSelection(event) {
  event.preventDefault();
  event.stopPropagation();
  const button = document.getElementById(BUTTON_ID);
  if (!button || !currentSelection) return;
  if (Date.now() < Number(button.dataset.readyAt || 0)) return;

  const rect = currentRange ? getRangeRect(currentRange) : button.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const selectedWord = getSingleEnglishWord(currentSelection);
  if (selectedWord) {
    removeSelectionButton();
    await openWordPopover(selectedWord, currentSelection, rect || buttonRect);
    return;
  }
  const popover = showLoadingPopover(rect, buttonRect);
  removeSelectionButton();

  try {
    const response = await chrome.runtime.sendMessage({
      type: "translate-text",
      mode: "selection",
      text: currentSelection
    });

    if (!response?.ok) throw new Error(response?.error || "翻译失败");
    if (popover.isConnected) {
      renderPopoverContent(popover, response.translation, false, currentSelection);
      positionPopover(popover, rect);
    }
  } catch (error) {
    if (popover.isConnected) {
      renderPopoverContent(popover, error.message || String(error), true);
      positionPopover(popover, rect);
    }
  }
}

function getSingleEnglishWord(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^["“‘([{<]+/, "")
    .replace(/["”’\)\]}>.,!?;:，。！？；：]+$/, "");
  return /^[A-Za-z]+(?:['’][A-Za-z]+|-[A-Za-z]+)*$/.test(normalized) ? normalized : null;
}

function showLoadingPopover(rect, sourceRect) {
  removeElement(POPOVER_ID);

  const popover = createPopover();
  renderPopoverLoading(popover);
  document.documentElement.appendChild(popover);
  const metrics = positionPopover(popover, rect);
  animatePopoverFrom(popover, sourceRect, metrics);
  return popover;
}

function showPopover(text, rect, isError = false, sourceRect = null) {
  removeElement(POPOVER_ID);

  const popover = createPopover();
  renderPopoverContent(popover, text, isError);
  document.documentElement.appendChild(popover);
  const metrics = positionPopover(popover, rect);
  if (sourceRect) animatePopoverFrom(popover, sourceRect, metrics);
  return popover;
}

function createPopover() {
  const popover = document.createElement("div");
  popover.id = POPOVER_ID;
  popover.addEventListener("mousedown", stopUiEvent);
  popover.addEventListener("mouseup", stopUiEvent);
  popover.addEventListener("click", stopUiEvent);
  return popover;
}

function renderPopoverLoading(popover) {
  popover.textContent = "";
  popover.dataset.state = "loading";

  const body = document.createElement("div");
  body.className = "model-translator-popover-loading";
  const translatingIconUrl = getExtensionAssetUrl(SELECTION_TRANSLATING_ICON_PATH);
  body.innerHTML = `
    ${translatingIconUrl ? `<img class="model-translator-query-animation" src="${translatingIconUrl}" draggable="false" alt="" />` : ""}
    <span class="model-translator-loading-label"><span>翻译中</span><span class="model-translator-loading-dots" aria-hidden="true"><span></span><span></span><span></span></span></span>
  `;

  const footer = document.createElement("div");
  footer.className = "model-translator-popover-footer";

  const typeLabel = document.createElement("span");
  typeLabel.className = "model-translator-popover-type";
  typeLabel.textContent = "随手划 · 自动识别 -> 中文";

  footer.appendChild(typeLabel);
  popover.append(body, footer);
}

function renderPopoverContent(popover, text, isError = false, sourceText = "") {
  popover.textContent = "";
  if (isError) {
    popover.dataset.state = "error";
  } else {
    delete popover.dataset.state;
  }

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "model-translator-popover-copy";
  copyButton.dataset.tip = "复制";
  copyButton.setAttribute("aria-label", "复制");
  copyButton.innerHTML = '<span class="model-translator-copy-icon" aria-hidden="true"></span>';
  copyButton.addEventListener("mousedown", (event) => event.preventDefault());
  copyButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const copied = await copyText(text);
    copyButton.dataset.tip = copied ? "已复制" : "复制失败";
    copyButton.setAttribute("aria-label", copyButton.dataset.tip);
    window.setTimeout(() => {
      copyButton.dataset.tip = "复制";
      copyButton.setAttribute("aria-label", "复制");
    }, 1200);
  });

  const body = document.createElement("div");
  body.className = "model-translator-popover-body";
  if (!isError && /[A-Za-z]/.test(sourceText)) {
    const source = document.createElement("div");
    source.className = "model-translator-popover-source";
    appendLearnableText(source, sourceText, sourceText);
    body.append(source);
  }
  const translation = document.createElement("div");
  translation.className = "model-translator-popover-translation";
  appendLearnableText(translation, text, text);
  body.append(translation);

  const footer = document.createElement("div");
  footer.className = "model-translator-popover-footer";

  const typeLabel = document.createElement("span");
  typeLabel.className = "model-translator-popover-type";
  typeLabel.textContent = isError ? "随手划" : "随手划 · 自动识别 -> 中文";

  footer.append(typeLabel, copyButton);
  popover.append(body, footer);
}

function appendLearnableText(container, text, sentence) {
  const value = String(text || "");
  const fragment = document.createDocumentFragment();
  const pattern = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;
  let index = 0;
  for (const match of value.matchAll(pattern)) {
    fragment.append(value.slice(index, match.index));
    const word = document.createElement("button");
    word.type = "button";
    word.className = "model-translator-learn-word";
    word.textContent = match[0];
    word.title = "点击查看单词学习资料";
    word.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openWordPopover(match[0], sentence, word.getBoundingClientRect());
    });
    fragment.append(word);
    index = match.index + match[0].length;
  }
  fragment.append(value.slice(index));
  container.append(fragment);
}

async function openWordPopover(word, sentence, anchorRect) {
  removeWordPopover();
  const translatingIconUrl = getExtensionAssetUrl(SELECTION_TRANSLATING_ICON_PATH);
  if (!translatingIconUrl) return;
  const popover = document.createElement("section");
  popover.id = WORD_POPOVER_ID;
  popover.dataset.pinned = "false";
  popover.innerHTML = `
    <div class="model-translator-word-loading">
      <img class="model-translator-query-animation" src="${translatingIconUrl}" draggable="false" alt="" />
      <span class="model-translator-loading-label"><span>正在查词</span><span class="model-translator-loading-dots" aria-hidden="true"><span></span><span></span><span></span></span></span>
    </div>
  `;
  popover.addEventListener("mousedown", stopUiEvent);
  popover.addEventListener("click", stopUiEvent);
  document.documentElement.appendChild(popover);
  positionWordPopover(popover, anchorRect);
  try {
    const response = await chrome.runtime.sendMessage({ type: "lookup-english-word", word, sentence });
    if (!response?.ok) throw new Error(response?.error || "查词失败");
    if (!popover.isConnected) return;
    renderWordPopover(popover, response.entry);
    positionWordPopover(popover, anchorRect);
  } catch (error) {
    if (popover.isConnected) {
      popover.innerHTML = `<div class="model-translator-word-error">${escapeHtml(error.message || String(error))}</div>`;
      positionWordPopover(popover, anchorRect);
    }
  }
}

function openSavedWordPopover(entry, anchorRect) {
  removeWordPopover();
  const popover = document.createElement("section");
  popover.id = WORD_POPOVER_ID;
  popover.dataset.pinned = "false";
  popover.addEventListener("mousedown", stopUiEvent);
  popover.addEventListener("click", stopUiEvent);
  document.documentElement.appendChild(popover);
  renderWordPopover(popover, { ...entry, favorite: true });
  positionWordPopover(popover, anchorRect);
}

function renderWordPopover(popover, entry) {
  popover.textContent = "";
  const head = document.createElement("div");
  head.className = "model-translator-word-head";
  head.innerHTML = `
    <div class="model-translator-word-intro"><div class="model-translator-word-drag-handle" data-word-drag-handle title="拖动窗口" aria-label="拖动窗口"><div class="model-translator-word-language">英语</div></div><div class="model-translator-word-title">${escapeHtml(entry.word)}</div><div class="model-translator-word-meta">${escapeHtml(entry.phonetic || "暂无音标")}</div></div>
    <div class="model-translator-word-tools"><button type="button" data-word-pin data-tip="临时置顶" title="临时置顶" aria-label="临时置顶"><span class="model-translator-word-tool-icon icon-pin" aria-hidden="true"></span></button><button type="button" data-word-copy data-tip="复制全部" aria-label="复制全部"><span class="model-translator-word-tool-icon icon-copy" aria-hidden="true"></span></button><button type="button" data-word-favorite class="${entry.favorite ? "is-active" : ""}" title="${entry.favorite ? "移出单词本" : "收藏到单词本"}" aria-label="${entry.favorite ? "移出单词本" : "收藏到单词本"}"><span class="model-translator-word-tool-icon icon-star ${entry.favorite ? "is-filled" : ""}" aria-hidden="true"></span></button><button type="button" data-word-close title="关闭" aria-label="关闭"><span class="model-translator-word-tool-icon icon-close" aria-hidden="true"></span></button></div>
  `;
  const sections = document.createElement("div");
  sections.className = "model-translator-word-sections";
  if (entry.contextMeaning) sections.append(createWordSection("当前语境", entry.contextMeaning));
  sections.append(createWordSection(formatWordPartOfSpeech(entry.partOfSpeech), (entry.meanings || []).map((item) => `• ${item}`).join("\n") || "暂无释义", false, "is-meaning"));
  if (entry.forms?.length) sections.append(createWordSection("词形", entry.forms.join(" · ")));
  if (entry.example) sections.append(createWordSection("示例", `${entry.example}${entry.exampleTranslation ? `\n${entry.exampleTranslation}` : ""}`, true));
  popover.append(head, sections);
  enableWordPopoverDrag(popover, head.querySelector("[data-word-drag-handle]"));
  popover.querySelector("[data-word-close]").addEventListener("click", removeWordPopover);
  popover.querySelector("[data-word-copy]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const copied = await copyText(formatWordDetailsForCopy(entry));
    button.dataset.tip = copied ? "已复制" : "复制失败";
    button.setAttribute("aria-label", button.dataset.tip);
    window.setTimeout(() => {
      button.dataset.tip = "复制全部";
      button.setAttribute("aria-label", "复制全部");
    }, 1200);
  });
  popover.querySelector("[data-word-pin]").addEventListener("click", (event) => {
    const pinned = popover.dataset.pinned === "true";
    popover.dataset.pinned = String(!pinned);
    event.currentTarget.classList.toggle("is-active", !pinned);
    event.currentTarget.title = pinned ? "临时置顶" : "取消置顶";
    event.currentTarget.setAttribute("aria-label", pinned ? "临时置顶" : "取消置顶");
    event.currentTarget.dataset.tip = event.currentTarget.title;
  });
  popover.querySelector("[data-word-favorite]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const icon = button.querySelector(".icon-star");
    const previousFavorite = Boolean(entry.favorite);
    entry.favorite = !previousFavorite;
    button.classList.toggle("is-active", entry.favorite);
    icon?.classList.toggle("is-filled", entry.favorite);
    button.title = entry.favorite ? "移出单词本" : "收藏到单词本";
    button.setAttribute("aria-label", button.title);
    const response = await chrome.runtime.sendMessage({ type: "toggle-word-favorite", entry });
    if (!response?.ok) {
      entry.favorite = previousFavorite;
      button.classList.toggle("is-active", previousFavorite);
      icon?.classList.toggle("is-filled", previousFavorite);
      button.title = response?.error || "收藏失败";
      button.setAttribute("aria-label", button.title);
      button.classList.add("is-error");
      window.setTimeout(() => button.classList.remove("is-error"), 1200);
      return;
    }
    entry.favorite = response.favorite;
    button.classList.toggle("is-active", entry.favorite);
    icon?.classList.toggle("is-filled", entry.favorite);
    button.title = entry.favorite ? "移出单词本" : "收藏到单词本";
    button.setAttribute("aria-label", button.title);
  });
}

function formatWordDetailsForCopy(entry) {
  const meanings = (entry.meanings || []).map((item) => `- ${item}`).join("\n");
  return [
    entry.word,
    entry.phonetic ? `音标：${entry.phonetic}` : "",
    entry.contextMeaning ? `当前语境：${entry.contextMeaning}` : "",
    `${formatWordPartOfSpeech(entry.partOfSpeech)}：\n${meanings || "暂无释义"}`,
    entry.forms?.length ? `词形：${entry.forms.join(" · ")}` : "",
    entry.example ? `示例：${entry.example}${entry.exampleTranslation ? `\n${entry.exampleTranslation}` : ""}` : ""
  ].filter(Boolean).join("\n\n");
}

function createWordSection(label, value, example = false, variant = "") {
  const section = document.createElement("section");
  section.className = `model-translator-word-section ${variant}`.trim();
  const title = document.createElement("div");
  title.className = "model-translator-word-label";
  title.textContent = label;
  const content = document.createElement("div");
  content.className = `model-translator-word-value${example ? " is-example" : ""}`;
  content.textContent = value;
  section.append(title, content);
  return section;
}

function formatWordPartOfSpeech(value) {
  const source = String(value || "").trim().toLowerCase();
  const names = { noun: "名词", verb: "动词", adjective: "形容词", adverb: "副词", pronoun: "代词", preposition: "介词", conjunction: "连词", interjection: "感叹词" };
  return names[source] || value || "释义";
}

function positionWordPopover(popover, rect) {
  if (popover.dataset.manualPosition === "true") return;
  const width = Math.min(350, Math.max(270, window.innerWidth - 28));
  popover.style.width = `${width}px`;
  const top = Math.min(window.innerHeight - popover.offsetHeight - 12, Math.max(12, rect.bottom + 10));
  const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.left));
  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;
}

function enableWordPopoverDrag(popover, dragHandle) {
  if (!dragHandle) return;
  let dragging = false;
  let startLeft = 0;
  let startTop = 0;
  let pointerX = 0;
  let pointerY = 0;
  dragHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = popover.getBoundingClientRect();
    dragging = true;
    startLeft = rect.left;
    startTop = rect.top;
    pointerX = event.clientX;
    pointerY = event.clientY;
    dragHandle.classList.add("is-dragging");
    dragHandle.setPointerCapture(event.pointerId);
  });
  dragHandle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    event.preventDefault();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const nextLeft = startLeft + event.clientX - pointerX;
    const nextTop = startTop + event.clientY - pointerY;
    const left = Math.min(Math.max(12, nextLeft), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(Math.max(12, nextTop), Math.max(12, window.innerHeight - height - 12));
    popover.dataset.manualPosition = "true";
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  });
  const finishDrag = () => {
    dragging = false;
    dragHandle.classList.remove("is-dragging");
  };
  dragHandle.addEventListener("pointerup", finishDrag);
  dragHandle.addEventListener("lostpointercapture", finishDrag);
}

function removeWordPopover() {
  removeElement(WORD_POPOVER_ID);
}

function positionPopover(popover, rect) {
  const width = Math.min(360, Math.max(260, window.innerWidth - 32));
  popover.style.width = `${width}px`;

  const top = Math.max(12, rect.top - popover.offsetHeight - 14);
  const left = Math.min(
    window.innerWidth - width - 12,
    Math.max(12, rect.left)
  );

  Object.assign(popover.style, {
    top: `${top}px`,
    left: `${left}px`
  });

  return { left, top, width, height: popover.offsetHeight };
}

function animatePopoverFrom(popover, sourceRect, metrics) {
  const sourceCenterX = sourceRect.left + sourceRect.width / 2;
  const sourceCenterY = sourceRect.top + sourceRect.height / 2;
  const popoverCenterX = metrics.left + metrics.width / 2;
  const popoverCenterY = metrics.top + metrics.height / 2;
  popover.style.setProperty("--model-translator-start-x", `${sourceCenterX - popoverCenterX}px`);
  popover.style.setProperty("--model-translator-start-y", `${sourceCenterY - popoverCenterY}px`);
  popover.style.setProperty("--model-translator-start-scale-x", String(sourceRect.width / metrics.width));
  popover.style.setProperty("--model-translator-start-scale-y", String(sourceRect.height / Math.max(metrics.height, 1)));
  popover.classList.add("is-opening");
  window.setTimeout(() => {
    popover.classList.remove("is-opening");
  }, 340);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    Object.assign(textarea.style, {
      position: "fixed",
      left: "-9999px",
      top: "0"
    });
    document.documentElement.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function createPageTranslationProgress(overrides = {}) {
  return {
    active: false,
    running: false,
    paused: false,
    total: 0,
    completed: 0,
    failed: 0,
    ...overrides
  };
}

function updatePageTranslationProgress(changes = {}) {
  pageTranslationProgress = {
    ...pageTranslationProgress,
    ...changes
  };
  pageTranslationProgress.total = Math.max(0, Number(pageTranslationProgress.total) || 0);
  pageTranslationProgress.completed = Math.min(
    pageTranslationProgress.total,
    Math.max(0, Number(pageTranslationProgress.completed) || 0)
  );
  pageTranslationProgress.failed = Math.min(
    Math.max(0, pageTranslationProgress.total - pageTranslationProgress.completed),
    Math.max(0, Number(pageTranslationProgress.failed) || 0)
  );
  updateFloatingPageProgressUi();
}

function resetPageTranslationProgress() {
  pageTranslationProgress = createPageTranslationProgress();
  pageTranslationProgressKnownNodes = new WeakSet();
  updateFloatingPageProgressUi();
}

function addPageTranslationProgressNodes(nodes) {
  let added = 0;
  nodes.forEach((node) => {
    if (pageTranslationProgressKnownNodes.has(node)) return;
    pageTranslationProgressKnownNodes.add(node);
    added += 1;
  });
  if (added) {
    updatePageTranslationProgress({
      total: pageTranslationProgress.total + added
    });
  }
}

function releasePageTranslationPauseWaiters() {
  const waiters = [...pageTranslationResumeWaiters];
  pageTranslationResumeWaiters.clear();
  waiters.forEach((resolve) => resolve());
}

function setPageTranslationPaused(paused) {
  const nextPaused = Boolean(paused) && pageTranslationRunning;
  pageTranslationPaused = nextPaused;
  updatePageTranslationProgress({
    active: pageTranslationRunning || pageTranslationFailedEntries.size > 0,
    running: pageTranslationRunning,
    paused: nextPaused
  });
  if (!nextPaused) releasePageTranslationPauseWaiters();
  return nextPaused;
}

function togglePageTranslationPaused() {
  if (!pageTranslationRunning) return false;
  return setPageTranslationPaused(!pageTranslationPaused);
}

async function waitForPageTranslationResume(cancelToken) {
  while (pageTranslationPaused && cancelToken === pageTranslationCancelToken) {
    await new Promise((resolve) => pageTranslationResumeWaiters.add(resolve));
  }
  if (cancelToken !== pageTranslationCancelToken) {
    throw new Error("已停止本次整页翻译。");
  }
}

function recordPageTranslationFailure(entries) {
  entries.forEach((entry) => {
    if (entry.node?.isConnected) pageTranslationFailedEntries.set(entry.node, entry);
  });
  updatePageTranslationProgress({
    failed: pageTranslationFailedEntries.size
  });
}

function clearPageTranslationFailure(entry) {
  if (!entry?.node) return;
  pageTranslationFailedEntries.delete(entry.node);
}

async function retryFailedPageTranslation() {
  const entries = [...pageTranslationFailedEntries.values()]
    .filter((entry) => entry.node?.isConnected && entry.node.nodeValue?.trim());
  if (!entries.length) {
    return 0;
  }

  entries.forEach((entry) => pageTranslationFailureCooldown.delete(entry.node));

  if (pageTranslationRunning) {
    pageTranslationQueued = true;
    return 0;
  }
  pageTranslationFailedEntries.clear();
  updatePageTranslationProgress({
    active: true,
    failed: 0
  });
  return translateVisiblePage({ fromScroll: true, retryEntries: entries });
}

function cancelPageTranslation() {
  pageTranslationEnabled = false;
  pageTranslationQueued = false;
  pageTranslationForceRefresh = false;
  pageTranslationCancelToken += 1;
  pageTranslationPaused = false;
  releasePageTranslationPauseWaiters();
  window.clearTimeout(pageLazyTimer);
  window.clearTimeout(pageHoverTimer);
  stopPageTranslationObserver();
  if (pageTranslationRequestId) {
    chrome.runtime.sendMessage({
      type: "cancel-page-translation",
      requestId: pageTranslationRequestId
    }).catch(() => {});
  }
  pageTranslationRequestId = "";
  pageTranslationFailedEntries.clear();
  updatePageTranslationProgress({
    active: false,
    running: false,
    paused: false,
    failed: 0
  });
  setFloatingPageTranslationBusy(false);
}

async function translateVisiblePage(options = {}) {
  await pageDisplayPreferenceReady;
  if (pageTranslationRunning) {
    pageTranslationQueued = true;
    if (options.waitForRunning) {
      await waitForPageTranslationIdle();
      if (!pageTranslationEnabled) return 0;
      return translateVisiblePage({ ...options, waitForRunning: false });
    }
    return 0;
  }
  pageTranslationRunning = true;
  pageTranslationEnabled = true;
  startPageTranslationObserver();
  const isNewSession = !options.fromScroll || !pageTranslationRequestId;
  if (isNewSession) {
    pageTranslationRequestId = createPageTranslationRequestId();
    pageTranslationForceRefresh = Boolean(options.forceRefresh);
    pageTranslationFailureCooldown = new WeakMap();
    pageTranslationFailedEntries = new Map();
    pageTranslationPaused = false;
    resetPageTranslationProgress();
  }
  updatePageTranslationProgress({
    active: true,
    running: true,
    paused: pageTranslationPaused,
    failed: pageTranslationFailedEntries.size
  });
  setFloatingPageTranslationBusy(true);
  const cancelToken = pageTranslationCancelToken;
  let shouldScheduleLazy = false;
  const failedChunks = [];

  try {
    prunePageTranslationCache();
    await loadPersistentPageTranslationCache();
    await waitForPageTranslationResume(cancelToken);
    const cacheMeta = await getPageCacheMeta();

    const retryNodes = Array.isArray(options.retryEntries)
      ? options.retryEntries
        .map((entry) => entry?.node)
        .filter((node) => node?.isConnected && node.nodeValue?.trim())
      : null;
    const nodes = (retryNodes || collectTextNodes()).slice(0, PAGE_LIMIT);
    addPageTranslationProgressNodes(nodes);
    let translatedCount = 0;
    let cachedCount = 0;
    const pending = [];

    for (const node of nodes) {
      if (cancelToken !== pageTranslationCancelToken) return translatedCount;
      const original = node.nodeValue;
      const text = original.trim();
      const cached = pageTranslationForceRefresh
        ? ""
        : getCachedPageTranslation(text) || getPersistentPageTranslation(text, cacheMeta);

      if (cached) {
        applyNodeTranslation(node, original, cached);
        translatedCount += 1;
        cachedCount += 1;
      } else {
        pending.push({ node, original, text });
      }
    }
    if (cachedCount) {
      updatePageTranslationProgress({
        completed: pageTranslationProgress.completed + cachedCount,
        failed: pageTranslationFailedEntries.size
      });
    }

    for (let index = 0; index < pending.length; index += PAGE_BATCH_SIZE * PAGE_BATCH_CONCURRENCY) {
      if (cancelToken !== pageTranslationCancelToken) return translatedCount;
      await waitForPageTranslationResume(cancelToken);
      const wave = [];
      for (let offset = 0; offset < PAGE_BATCH_SIZE * PAGE_BATCH_CONCURRENCY; offset += PAGE_BATCH_SIZE) {
        const chunk = pending.slice(index + offset, index + offset + PAGE_BATCH_SIZE);
        if (chunk.length) {
          wave.push(translatePageChunk(chunk, index + offset, cacheMeta, cancelToken));
        }
      }

      const results = await Promise.allSettled(wave);
      if (cancelToken !== pageTranslationCancelToken) return translatedCount;
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          translatedCount += result.value;
        } else {
          failedChunks.push(result.reason);
        }
      });
    }

    shouldScheduleLazy = true;
    if (!translatedCount && failedChunks.length) throw failedChunks[0];
    return translatedCount;
  } finally {
    pageTranslationRunning = false;
    pageTranslationPaused = false;
    releasePageTranslationPauseWaiters();
    updatePageTranslationProgress({
      active: pageTranslationFailedEntries.size > 0,
      running: false,
      paused: false,
      failed: pageTranslationFailedEntries.size
    });
    setFloatingPageTranslationBusy(false);
    const shouldRunQueued = pageTranslationQueued;
    pageTranslationQueued = false;
    if (pageTranslationEnabled && ((shouldScheduleLazy && !options.fromScroll) || shouldRunQueued)) {
      scheduleLazyPageTranslation();
    }
  }
}

async function translatePageChunk(chunk, baseIndex, cacheMeta, cancelToken) {
  const items = chunk.map((entry, offset) => ({
    id: baseIndex + offset,
    text: entry.text
  }));
  const batchId = `batch-${baseIndex}-${hashText(items.map((item) => `${item.id}:${item.text}`).join("\n"))}`;
  let response;

  try {
    for (let attempt = 0; attempt <= PAGE_BATCH_RETRY_LIMIT; attempt += 1) {
      if (cancelToken !== pageTranslationCancelToken) return 0;
      await waitForPageTranslationResume(cancelToken);
      response = await chrome.runtime.sendMessage({
        type: "translate-batch",
        requestId: pageTranslationRequestId,
        batchId,
        items
      });
      if (response?.ok) break;
      if (!response?.retryable || attempt >= PAGE_BATCH_RETRY_LIMIT) {
        throw new Error(response?.error || "整页翻译失败");
      }
      const retryDelay = Math.max(
        Number(response.retryAfterMs || 0),
        PAGE_BATCH_RETRY_BASE_DELAY_MS * (2 ** attempt)
      );
      await waitForPageBatchRetry(retryDelay, cancelToken);
    }
  } catch (error) {
    if (cancelToken !== pageTranslationCancelToken) throw error;
    const retryAt = Date.now() + PAGE_FAILED_NODE_COOLDOWN_MS;
    chunk.forEach((entry) => pageTranslationFailureCooldown.set(entry.node, retryAt));
    recordPageTranslationFailure(chunk);
    throw error;
  }

  if (!response?.ok) throw new Error(response?.error || "整页翻译失败");
  if (cancelToken !== pageTranslationCancelToken) return 0;
  await waitForPageTranslationResume(cancelToken);

  let translatedCount = 0;
  const missingEntries = [];
  const translations = new Map(response.items.map((item) => [item.id, item.translation]));
  for (let offset = 0; offset < chunk.length; offset += 1) {
    if (cancelToken !== pageTranslationCancelToken) return translatedCount;
    await waitForPageTranslationResume(cancelToken);
    const entry = chunk[offset];
    const translation = translations.get(baseIndex + offset);
    if (!translation) {
      missingEntries.push(entry);
      continue;
    }

    pageTranslationFailureCooldown.delete(entry.node);
    clearPageTranslationFailure(entry);
    setCachedPageTranslation(entry.text, translation);
    setPersistentPageTranslation(entry.text, translation, cacheMeta);
    applyNodeTranslation(entry.node, entry.original, translation);
    translatedCount += 1;
  }
  if (missingEntries.length) {
    const retryAt = Date.now() + PAGE_FAILED_NODE_COOLDOWN_MS;
    missingEntries.forEach((entry) => pageTranslationFailureCooldown.set(entry.node, retryAt));
    recordPageTranslationFailure(missingEntries);
  }
  if (translatedCount) {
    updatePageTranslationProgress({
      completed: pageTranslationProgress.completed + translatedCount,
      failed: pageTranslationFailedEntries.size
    });
  }
  return translatedCount;
}

async function waitForPageBatchRetry(delay, cancelToken) {
  await new Promise((resolve) => window.setTimeout(resolve, Math.min(Math.max(delay, 250), 15000)));
  await waitForPageTranslationResume(cancelToken);
  if (cancelToken !== pageTranslationCancelToken) {
    throw new Error("已停止本次整页翻译。");
  }
}

function applyNodeTranslation(node, original, translation) {
  if (translatedNodeSet.has(node)) return;
  const entry = { node, original, translation: preserveOuterWhitespace(original, translation), wrapper: null, compactTarget: null, originalTitle: null };
  translatedNodes.push(entry);
  translatedNodeSet.add(node);
  renderPageTranslationEntry(entry);
}

function togglePageBilingualDisplay() {
  return setPageBilingualDisplay(pageTranslationDisplayMode !== "bilingual");
}

function setPageBilingualDisplay(enabled, { persist = true } = {}) {
  pageTranslationDisplayMode = enabled ? "bilingual" : "translated";
  document.documentElement.dataset.modelTranslatorPageDisplayMode = pageTranslationDisplayMode;
  if (persist) {
    chrome.storage.local.set({ [PAGE_DISPLAY_MODE_KEY]: pageTranslationDisplayMode }).catch(() => {});
  }
  if (translatedNodes.length) translatedNodes.forEach(renderPageTranslationEntry);
  updateFloatingPageDisplayModeUi();
  return { translated: translatedNodes.length > 0, bilingual: pageTranslationDisplayMode === "bilingual" };
}

function updateFloatingPageDisplayModeUi() {
  const shadow = document.getElementById(FLOATING_HOST_ID)?.shadowRoot;
  if (!shadow) return;
  const displayDot = shadow.querySelector('[data-action="display"]');
  const displayMenu = shadow.querySelector(".floating-page-display-menu");
  const bilingual = pageTranslationDisplayMode === "bilingual";
  displayDot?.classList.toggle("is-bilingual", bilingual);
  displayMenu?.querySelectorAll("[data-page-display]").forEach((option) => {
    option.classList.toggle("is-selected", (option.dataset.pageDisplay === "bilingual") === bilingual);
  });
}

async function syncPageTranslationDisplayPreference() {
  try {
    const stored = await chrome.storage.local.get({ [PAGE_DISPLAY_MODE_KEY]: "translated" });
    setPageBilingualDisplay(stored[PAGE_DISPLAY_MODE_KEY] === "bilingual", { persist: false });
  } catch {
    setPageBilingualDisplay(pageTranslationDisplayMode === "bilingual", { persist: false });
  }
}

function syncPageDisplayModeFromComposedClick(event) {
  const option = event.composedPath().find((node) => node?.matches?.("[data-page-display]"));
  if (!option) return;
  setPageBilingualDisplay(option.dataset.pageDisplay === "bilingual");
}

function renderPageTranslationEntry(entry) {
  if (pageTranslationDisplayMode !== "bilingual") {
    if (entry.wrapper?.isConnected) entry.wrapper.replaceWith(entry.node);
    entry.wrapper = null;
    if (entry.compactTarget) {
      entry.compactTarget.title = entry.originalTitle || "";
      entry.compactTarget = null;
      entry.originalTitle = null;
    }
    entry.node.nodeValue = entry.translation;
    return;
  }

  if (entry.compactTarget) {
    entry.compactTarget.title = entry.originalTitle || "";
    entry.compactTarget = null;
    entry.originalTitle = null;
  }

  if (entry.wrapper?.isConnected) return;
  const wrapper = document.createElement("span");
  wrapper.className = "model-translator-bilingual-segment";
  wrapper.dataset.modelTranslatorBilingual = "true";
  if (shouldStackBilingualNode(entry.node)) wrapper.classList.add("is-stacked");
  const translation = document.createElement("span");
  translation.className = "model-translator-bilingual-translation";
  translation.textContent = entry.translation;
  const original = document.createElement("span");
  original.className = "model-translator-bilingual-original";
  original.textContent = entry.original.trim();
  wrapper.append(translation, original);
  entry.node.replaceWith(wrapper);
  entry.wrapper = wrapper;
}

function shouldStackBilingualNode(node) {
  const parent = node.parentElement;
  if (!parent) return false;
  const meaningfulChildren = Array.from(parent.childNodes).filter((child) => child.nodeType !== Node.TEXT_NODE || child.nodeValue.trim());
  return meaningfulChildren.length === 1 && /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|TD|TH|DT|DD)$/i.test(parent.tagName);
}

function restorePageText() {
  cancelPageTranslation();
  translatedNodes.reverse().forEach((entry) => {
    if (entry.wrapper?.isConnected) entry.wrapper.replaceWith(entry.node);
    if (entry.compactTarget) entry.compactTarget.title = entry.originalTitle || "";
    if (entry.node?.isConnected) entry.node.nodeValue = entry.original;
  });
  translatedNodes = [];
  translatedNodeSet = new WeakSet();
  resetPageTranslationProgress();
}

function createPageTranslationRequestId() {
  return `page-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function scheduleLazyPageTranslation() {
  if (!pageTranslationEnabled) return;
  if (pageTranslationRunning) {
    pageTranslationQueued = true;
    return;
  }
  window.clearTimeout(pageLazyTimer);
  pageLazyTimer = window.setTimeout(() => {
    if (pageTranslationEnabled && !pageTranslationRunning) {
      translateVisiblePage({ fromScroll: true }).catch(() => {});
    } else if (pageTranslationEnabled && pageTranslationRunning) {
      pageTranslationQueued = true;
    }
  }, 550);
}

async function waitForPageTranslationIdle() {
  const startedAt = Date.now();
  while (pageTranslationRunning && Date.now() - startedAt < 15000) {
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
}

function startPageTranslationObserver() {
  if (!document.body) return;
  ensurePageIntersectionObserver();
  if (!pageCandidateScanInitialized) {
    registerPageTranslationCandidates(document.body);
    pageCandidateScanInitialized = true;
  }
  if (pageMutationObserver) return;
  pageMutationObserver = new MutationObserver((mutations) => {
    if (!pageTranslationEnabled) return;
    let relevant = false;
    mutations.forEach((mutation) => {
      if (!isRelevantPageMutation(mutation)) return;
      relevant = true;
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach(registerPageTranslationCandidates);
        mutation.removedNodes.forEach(unregisterPageTranslationCandidates);
      } else if (mutation.target instanceof Element) {
        refreshPageCandidateElement(mutation.target);
      }
    });
    if (!relevant) return;
    scheduleLazyPageTranslation();
  });
  pageMutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-expanded"]
  });
}

function stopPageTranslationObserver() {
  pageMutationObserver?.disconnect();
  pageMutationObserver = null;
  pageIntersectionObserver?.disconnect();
  pageIntersectionObserver = null;
  pageCandidateElements.clear();
  pageVisibleCandidateNodes.clear();
  pageCandidateScanInitialized = false;
}

function isRelevantPageMutation(mutation) {
  const target = mutation.target;
  if (!(target instanceof Element)) return false;
  if (target.closest(`#${BUTTON_ID}, #${POPOVER_ID}, #${WORD_POPOVER_ID}, #${FLOATING_HOST_ID}`)) return false;
  if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(target.tagName)) return false;
  return true;
}

function ensurePageIntersectionObserver() {
  if (pageIntersectionObserver) return;
  pageIntersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const nodes = pageCandidateElements.get(entry.target);
      if (!nodes) return;
      nodes.forEach((node) => {
        if (entry.isIntersecting && isPageTranslationNodeEligible(node, true)) {
          pageVisibleCandidateNodes.add(node);
        } else {
          pageVisibleCandidateNodes.delete(node);
        }
      });
    });
  }, {
    root: null,
    rootMargin: `${PAGE_INTERSECTION_MARGIN}px 180px`,
    threshold: 0
  });
}

function registerPageTranslationCandidates(root) {
  if (!root || !document.body) return;
  ensurePageIntersectionObserver();
  if (root.nodeType === Node.TEXT_NODE) {
    registerPageTranslationCandidateNode(root);
    return;
  }
  if (!(root instanceof Element) && root !== document.body) return;

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return isPageTranslationNodeEligible(node, false)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    }
  );
  while (walker.nextNode()) registerPageTranslationCandidateNode(walker.currentNode);
}

function registerPageTranslationCandidateNode(node) {
  if (!isPageTranslationNodeEligible(node, false)) return;
  const element = node.parentElement;
  if (!element) return;
  let nodes = pageCandidateElements.get(element);
  if (!nodes) {
    nodes = new Set();
    pageCandidateElements.set(element, nodes);
    pageIntersectionObserver.observe(element);
  }
  nodes.add(node);
  refreshPageCandidateElement(element);
}

function unregisterPageTranslationCandidates(root) {
  if (!root) return;
  const matchesRoot = (element) => (
    root === element ||
    (root instanceof Element && root.contains(element)) ||
    (root.nodeType === Node.TEXT_NODE && root.parentElement === element)
  );
  pageCandidateElements.forEach((nodes, element) => {
    if (!matchesRoot(element)) return;
    nodes.forEach((node) => pageVisibleCandidateNodes.delete(node));
    pageIntersectionObserver?.unobserve(element);
    pageCandidateElements.delete(element);
  });
}

function refreshPageCandidateElement(element) {
  const nodes = pageCandidateElements.get(element);
  if (!nodes) return;
  const nearViewport = isElementNearTranslationViewport(element);
  nodes.forEach((node) => {
    if (nearViewport && isPageTranslationNodeEligible(node, true)) {
      pageVisibleCandidateNodes.add(node);
    } else {
      pageVisibleCandidateNodes.delete(node);
    }
  });
}

function isElementNearTranslationViewport(element) {
  if (!isElementVisible(element)) return false;
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1200;
  return (
    rect.bottom >= -PAGE_INTERSECTION_MARGIN &&
    rect.top <= viewportHeight + PAGE_INTERSECTION_MARGIN &&
    rect.right >= -180 &&
    rect.left <= viewportWidth + 180
  );
}

function setFloatingPageTranslationBusy(isBusy) {
  setFloatingAssistantTranslationBusy("page", isBusy);
  const host = document.getElementById(FLOATING_HOST_ID);
  const shadow = host?.shadowRoot;
  if (!shadow) return;
  const cluster = shadow.querySelector(".floating-cluster");
  const pageButton = shadow.querySelector('[data-action="page"]');
  cluster?.classList.toggle("is-page-translating", isBusy);
  if (pageButton) {
    pageButton.toggleAttribute("aria-busy", isBusy);
    updateFloatingPageProgressUi();
    if (!isBusy && !pageTranslationProgress.active) {
      updateFloatingPageButton(shadow.querySelector(".floating-menu"), { translated: translatedNodes.length > 0 });
    }
  }
}

function updateFloatingPageProgressUi() {
  const shadow = document.getElementById(FLOATING_HOST_ID)?.shadowRoot;
  if (!shadow) return;
  const wrap = shadow.querySelector(".tool-button-page-wrap");
  const button = shadow.querySelector('[data-action="page"]');
  const retryButton = shadow.querySelector(".page-translation-retry");
  const cancelButton = shadow.querySelector(".page-translation-cancel");
  const popover = shadow.querySelector(".page-translation-progress-popover");
  if (!wrap || !button || !retryButton || !cancelButton || !popover) return;

  const active = Boolean(pageTranslationProgress.active);
  const total = Math.max(0, pageTranslationProgress.total);
  const completed = Math.min(total, Math.max(0, pageTranslationProgress.completed));
  const failed = Math.min(Math.max(0, total - completed), Math.max(0, pageTranslationProgress.failed));
  const pending = Math.max(0, total - completed - failed);
  const progress = total ? Math.min(100, Math.max(0, (completed / total) * 100)) : 0;
  const translated = translatedNodes.length > 0;
  const canRetryFailed = active && failed > 0;
  const canRetranslatePage = !active && translated;

  wrap.classList.toggle("is-translating", active);
  button.classList.toggle("is-page-progress", active);
  button.classList.toggle("is-paused", active && pageTranslationProgress.paused);
  button.classList.remove("is-busy");
  button.style.setProperty("--page-progress", `${progress}%`);
  retryButton.hidden = !canRetryFailed && !canRetranslatePage;
  retryButton.classList.toggle("is-page-retranslate", canRetranslatePage);
  cancelButton.hidden = !active;
  popover.hidden = !active;
  retryButton.dataset.floatingTip = canRetranslatePage ? "重新翻译整页" : "重试失败内容";
  retryButton.setAttribute("aria-label", retryButton.dataset.floatingTip);
  popover.querySelector("[data-progress-completed]").textContent = String(completed);
  popover.querySelector("[data-progress-pending]").textContent = String(pending);
  popover.querySelector("[data-progress-failed]").textContent = String(failed);

  if (!active) {
    const tooltip = shadow.querySelector(".floating-action-tooltip");
    tooltip?.classList.remove("is-visible");
    if (tooltip) tooltip.hidden = true;
    button.removeAttribute("data-floating-tip");
    return;
  }

  const paused = Boolean(pageTranslationProgress.paused);
  const running = Boolean(pageTranslationProgress.running);
  button.innerHTML = `
    <span class="page-progress-fill" aria-hidden="true"></span>
    <span class="page-progress-waiting" aria-hidden="true"></span>
    <span class="ui-icon ${paused ? "icon-resume" : "icon-page"}" aria-hidden="true"></span>
  `;
  button.dataset.tip = "";
  button.dataset.floatingTip = paused ? "继续翻译" : (running ? "暂停翻译" : "等待重试或取消");
  button.setAttribute("aria-label", button.dataset.floatingTip);
}

function setFloatingAssistantTranslationBusy(requestId, isBusy) {
  const key = String(requestId || "translation");
  if (isBusy) {
    assistantTranslationBusyKeys.add(key);
  } else {
    assistantTranslationBusyKeys.delete(key);
  }

  const shadow = document.getElementById(FLOATING_HOST_ID)?.shadowRoot;
  const assistantIcon = shadow?.querySelector(".floating-assistant-image");
  if (!assistantIcon) return;
  const animationState = assistantTranslationBusyKeys.size ? "translating" : "idle";
  shadow.querySelector(".floating-cluster")?.classList.toggle("is-assistant-translating", animationState === "translating");
  if (assistantIcon.dataset.animationState === animationState) return;
  const iconUrl = getExtensionAssetUrl(
    animationState === "translating" ? ASSISTANT_TRANSLATING_ICON_PATH : ASSISTANT_IDLE_ICON_PATH
  );
  if (!iconUrl) return;
  assistantIcon.dataset.animationState = animationState;
  assistantIcon.setAttribute("href", iconUrl);
}

function getCachedPageTranslation(text) {
  const cached = pageTranslationCache.get(text);
  if (!cached) return "";
  if (Date.now() - cached.createdAt > PAGE_CACHE_TTL_MS) {
    pageTranslationCache.delete(text);
    return "";
  }
  return cached.translation;
}

function setCachedPageTranslation(text, translation) {
  pageTranslationCache.set(text, {
    translation,
    createdAt: Date.now()
  });
}

function prunePageTranslationCache() {
  const now = Date.now();
  pageTranslationCache.forEach((cached, text) => {
    if (now - cached.createdAt > PAGE_CACHE_TTL_MS) {
      pageTranslationCache.delete(text);
    }
  });
}

async function getPageCacheMeta() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-settings-meta" });
    return {
      model: response?.ok ? response.model || "" : "",
      targetLanguage: response?.ok ? response.targetLanguage || "中文" : "中文"
    };
  } catch {
    return { model: "", targetLanguage: "中文" };
  }
}

async function loadPersistentPageTranslationCache() {
  if (pagePersistentCacheLoaded) return;
  const stored = await chrome.storage.local.get({ [PAGE_PERSISTENT_CACHE_KEY]: {} });
  pagePersistentCache = stored[PAGE_PERSISTENT_CACHE_KEY] || {};
  pagePersistentCacheLoaded = true;
  prunePersistentPageTranslationCache();
}

function getPersistentPageTranslation(text, meta) {
  const key = getPageTranslationCacheKey(text, meta);
  const cached = pagePersistentCache[key];
  if (!cached) return "";
  if (Date.now() - cached.createdAt > PAGE_PERSISTENT_CACHE_TTL_MS) {
    delete pagePersistentCache[key];
    return "";
  }
  return cached.translation || "";
}

function setPersistentPageTranslation(text, translation, meta) {
  const key = getPageTranslationCacheKey(text, meta);
  const entry = {
    translation,
    createdAt: Date.now()
  };
  pagePersistentCache[key] = entry;
  queuePageTranslationCacheEntry(key, entry);
  prunePersistentPageTranslationCache();
}

function prunePersistentPageTranslationCache() {
  const now = Date.now();
  Object.keys(pagePersistentCache).forEach((key) => {
    if (now - Number(pagePersistentCache[key]?.createdAt || 0) > PAGE_PERSISTENT_CACHE_TTL_MS) {
      delete pagePersistentCache[key];
    }
  });

  const entries = Object.entries(pagePersistentCache);
  if (entries.length <= PAGE_PERSISTENT_CACHE_MAX) return;
  entries
    .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0))
    .slice(PAGE_PERSISTENT_CACHE_MAX)
    .forEach(([key]) => delete pagePersistentCache[key]);
}

function queuePageTranslationCacheEntry(key, entry) {
  const previous = pagePersistentCacheDirtyEntries.get(key);
  if (previous) {
    pagePersistentCacheDirtyBytes -= estimatePageCacheEntryBytes(key, previous);
  }
  pagePersistentCacheDirtyEntries.delete(key);
  pagePersistentCacheDirtyEntries.set(key, entry);
  pagePersistentCacheDirtyBytes += estimatePageCacheEntryBytes(key, entry);
  trimPendingPageTranslationCache();

  if (
    pagePersistentCacheDirtyEntries.size >= PAGE_CACHE_FLUSH_ENTRY_LIMIT ||
    pagePersistentCacheDirtyBytes >= PAGE_CACHE_FLUSH_BYTE_LIMIT
  ) {
    void flushPageTranslationCache();
    return;
  }
  schedulePageTranslationCacheFlush();
}

function schedulePageTranslationCacheFlush() {
  window.clearTimeout(pagePersistentCacheFlushTimer);
  if (!pagePersistentCacheDirtyEntries.size) {
    pagePersistentCacheFlushTimer = 0;
    return;
  }
  pagePersistentCacheFlushTimer = window.setTimeout(() => {
    pagePersistentCacheFlushTimer = 0;
    void flushPageTranslationCache();
  }, PAGE_CACHE_FLUSH_DELAY_MS);
}

function flushPageTranslationCache() {
  window.clearTimeout(pagePersistentCacheFlushTimer);
  pagePersistentCacheFlushTimer = 0;
  if (!pagePersistentCacheDirtyEntries.size) return Promise.resolve();

  const entries = Array.from(pagePersistentCacheDirtyEntries, ([key, entry]) => ({ key, ...entry }));
  pagePersistentCacheDirtyEntries.clear();
  pagePersistentCacheDirtyBytes = 0;

  return (async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "persist-page-translation-cache",
        entries
      });
      if (!response?.ok) throw new Error(response?.error || "页面翻译缓存写入失败");
    } catch {
      requeuePageTranslationCacheEntries(entries);
      schedulePageTranslationCacheFlush();
    }
  })();
}

function requeuePageTranslationCacheEntries(entries) {
  entries.forEach(({ key, translation, createdAt }) => {
    const current = pagePersistentCacheDirtyEntries.get(key);
    if (current && Number(current.createdAt || 0) >= Number(createdAt || 0)) return;
    if (current) {
      pagePersistentCacheDirtyBytes -= estimatePageCacheEntryBytes(key, current);
      pagePersistentCacheDirtyEntries.delete(key);
    }
    const entry = { translation, createdAt };
    pagePersistentCacheDirtyEntries.set(key, entry);
    pagePersistentCacheDirtyBytes += estimatePageCacheEntryBytes(key, entry);
  });
  trimPendingPageTranslationCache();
}

function trimPendingPageTranslationCache() {
  while (
    pagePersistentCacheDirtyEntries.size > PAGE_CACHE_PENDING_ENTRY_MAX ||
    pagePersistentCacheDirtyBytes > PAGE_CACHE_PENDING_BYTE_MAX
  ) {
    const oldest = pagePersistentCacheDirtyEntries.entries().next().value;
    if (!oldest) break;
    const [key, entry] = oldest;
    pagePersistentCacheDirtyEntries.delete(key);
    pagePersistentCacheDirtyBytes -= estimatePageCacheEntryBytes(key, entry);
  }
}

function estimatePageCacheEntryBytes(key, entry) {
  return (key.length + String(entry?.translation || "").length) * 2 + 32;
}

function getPageTranslationCacheKey(text, meta) {
  return hashText(`${getNormalizedPageCacheUrl()}\n${meta?.model || ""}\n${meta?.targetLanguage || "中文"}\n${text}`);
}

function getNormalizedPageCacheUrl() {
  try {
    const url = new URL(location.href);
    url.hash = "";
    Array.from(url.searchParams.keys()).forEach((key) => {
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    });
    url.searchParams.sort();
    return url.toString();
  } catch {
    return `${location.origin}${location.pathname}${location.search}`;
  }
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function collectTextNodes() {
  if (!pageCandidateScanInitialized && document.body) {
    registerPageTranslationCandidates(document.body);
    pageCandidateScanInitialized = true;
  }
  const now = Date.now();
  const nodes = [];
  pageVisibleCandidateNodes.forEach((node) => {
    if (!node.isConnected || !isPageTranslationNodeEligible(node, true)) {
      pageVisibleCandidateNodes.delete(node);
      return;
    }
    if (Number(pageTranslationFailureCooldown.get(node) || 0) > now) return;
    nodes.push(node);
  });
  return nodes
    .map((node, order) => ({ node, order, score: getNodeViewportScore(node) }))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map((item) => item.node);
}

function isPageTranslationNodeEligible(node, requireVisible) {
  if (!(node instanceof Text)) return false;
  const text = node.nodeValue.trim();
  const parent = node.parentElement;
  if (!parent || text.length < 2) return false;
  if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE"].includes(parent.tagName)) {
    return false;
  }
  if (translatedNodeSet.has(node)) return false;
  if (parent.closest("[data-model-translator-bilingual]")) return false;
  if (parent.closest(`#${BUTTON_ID}, #${POPOVER_ID}, #${WORD_POPOVER_ID}, #${FLOATING_HOST_ID}`)) return false;
  if (parent.isContentEditable || parent.closest("[contenteditable='true']")) return false;
  return !requireVisible || isElementVisible(parent);
}

function getNodeViewportScore(node) {
  const element = node.parentElement;
  const rect = element?.getBoundingClientRect();
  if (!rect) return Number.MAX_SAFE_INTEGER;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1200;
  const expandedTop = -280;
  const expandedBottom = viewportHeight + 680;
  let score = 0;

  if (rect.bottom >= expandedTop && rect.top <= expandedBottom) {
    score += Math.abs(rect.top) * 0.08;
  } else if (rect.top > expandedBottom) {
    score += rect.top - expandedBottom + 1000;
  } else {
    score += expandedTop - rect.bottom + 2000;
  }

  const centerX = rect.left + rect.width / 2;
  const centerDistance = Math.abs(centerX - viewportWidth / 2) / Math.max(1, viewportWidth / 2);
  score += centerDistance * 180;

  if (rect.right < viewportWidth * 0.18 || rect.left > viewportWidth * 0.82) score += 90;
  if (isPrimaryContentElement(element)) score -= 180;
  if (isPageChromeElement(element)) score -= 260;
  if (isInteractiveTextElement(element)) score -= 100;

  const style = window.getComputedStyle(element);
  if (style.position === "fixed" || style.position === "sticky") score -= 180;

  const textLength = node.nodeValue.trim().length;
  if (textLength >= 80) score -= 130;
  else if (textLength >= 36) score -= 80;
  else if (textLength <= 4) score += 70;
  else if (textLength <= 18 && isPageChromeElement(element)) score -= 80;

  return score;
}

function isPrimaryContentElement(element) {
  return Boolean(element.closest("main, article, [role='main'], .content, .post, .article, .markdown-body"));
}

function isPageChromeElement(element) {
  return Boolean(
    element.closest(
      "nav, header, aside, footer, menu, [role='navigation'], [role='banner'], [role='complementary'], [role='contentinfo'], [aria-label*='导航'], [aria-label*='菜单'], [class*='sidebar'], [class*='sider'], [class*='navbar'], [class*='menu'], [class*='toc']"
    )
  );
}

function isInteractiveTextElement(element) {
  return Boolean(element.closest("a, button, summary, [role='button'], [role='link'], [role='menuitem']"));
}

function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function preserveOuterWhitespace(original, replacement) {
  const leading = original.match(/^\s*/)?.[0] || "";
  const trailing = original.match(/\s*$/)?.[0] || "";
  return `${leading}${replacement}${trailing}`;
}

function getRangeRect(range) {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
  return rects[rects.length - 1] || range.getBoundingClientRect();
}

function getRangeEndpointAnchors(range) {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
  if (!rects.length) {
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    rects.push(rect);
  }

  const firstRect = rects[0];
  const lastRect = rects[rects.length - 1];
  const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  const isRtl = startElement instanceof Element && window.getComputedStyle(startElement).direction === "rtl";
  return {
    start: {
      x: isRtl ? firstRect.right : firstRect.left,
      y: firstRect.top + firstRect.height / 2,
      side: isRtl ? "right" : "left"
    },
    end: {
      x: isRtl ? lastRect.left : lastRect.right,
      y: lastRect.top + lastRect.height / 2,
      side: isRtl ? "left" : "right"
    }
  };
}

function getPointDistance(point, anchor) {
  return Math.hypot(point.clientX - anchor.x, point.clientY - anchor.y);
}

function removeSelectionUi() {
  removeSelectionButton();
  removeElement(POPOVER_ID);
}

function removeSelectionButton() {
  removeElement(BUTTON_ID);
}

function removeElement(id) {
  document.getElementById(id)?.remove();
}

function getExtensionAssetUrl(path) {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.getURL) return "";
    return chrome.runtime.getURL(path);
  } catch {
    return "";
  }
}

async function syncSelectionTranslationPreference() {
  try {
    const stored = await chrome.storage.local.get({ [SELECTION_TRANSLATION_ENABLED_KEY]: true });
    applySelectionTranslationPreference(stored[SELECTION_TRANSLATION_ENABLED_KEY] !== false);
  } catch {
    applySelectionTranslationPreference(true);
  }
}

function applySelectionTranslationPreference(enabled) {
  selectionTranslationEnabled = enabled !== false;
  if (!selectionTranslationEnabled) removeSelectionUi();
  updateFloatingSelectionMode();
}

function updateFloatingSelectionMode() {
  const shadow = document.getElementById(FLOATING_HOST_ID)?.shadowRoot;
  if (!shadow) return;
  const cluster = shadow.querySelector(".floating-cluster");
  const toggle = shadow.querySelector(".floating-selection-toggle");
  cluster?.classList.toggle("is-selection-enabled", selectionTranslationEnabled);
  if (!toggle) return;
  toggle.dataset.tip = selectionTranslationEnabled ? "收起随手划" : "开启随手划";
  toggle.setAttribute("aria-label", toggle.dataset.tip);
  toggle.setAttribute("aria-pressed", String(selectionTranslationEnabled));
}

function isTranslatorUiTarget(target) {
  return target instanceof Element && Boolean(target.closest(`#${BUTTON_ID}, #${POPOVER_ID}, #${WORD_POPOVER_ID}, #${FLOATING_HOST_ID}`));
}

function stopUiEvent(event) {
  event.stopPropagation();
}

async function syncAssistantModeVisibility() {
  const host = document.getElementById(FLOATING_HOST_ID);
  if (document.fullscreenElement) {
    host?.remove();
    document.getElementById(FLOATING_GLASS_ID)?.remove();
    document.getElementById(FLOATING_GLASS_DEFINITIONS_ID)?.remove();
    return;
  }

  const active = await isAssistantModeActive();
  if (active) {
    if (!host) initFloatingLauncher();
  } else {
    host?.remove();
    document.getElementById(FLOATING_GLASS_ID)?.remove();
    document.getElementById(FLOATING_GLASS_DEFINITIONS_ID)?.remove();
  }
}

async function isAssistantModeActive() {
  try {
    const stored = await chrome.storage.local.get({
      [ASSISTANT_MODE_ENABLED_KEY]: false,
      [ASSISTANT_MODE_PAUSED_UNTIL_KEY]: 0
    });
    const enabled = stored[ASSISTANT_MODE_ENABLED_KEY] !== false;
    const pausedUntil = Number(stored[ASSISTANT_MODE_PAUSED_UNTIL_KEY] || 0);
    if (pausedUntil && pausedUntil <= Date.now()) {
      await chrome.storage.local.set({ [ASSISTANT_MODE_PAUSED_UNTIL_KEY]: 0 });
      return enabled;
    }
    return enabled && pausedUntil <= Date.now();
  } catch {
    return false;
  }
}

async function pauseAssistantMode() {
  await chrome.storage.local.set({
    [ASSISTANT_MODE_ENABLED_KEY]: true,
    [ASSISTANT_MODE_PAUSED_UNTIL_KEY]: Date.now() + ASSISTANT_MODE_PAUSE_MS
  });
}

async function disableAssistantMode() {
  await chrome.storage.local.set({
    [ASSISTANT_MODE_ENABLED_KEY]: false,
    [ASSISTANT_MODE_PAUSED_UNTIL_KEY]: 0
  });
}

function initFloatingLauncher() {
  if (document.getElementById(FLOATING_HOST_ID)) return;
  const assistantIdleUrl = getExtensionAssetUrl(ASSISTANT_IDLE_ICON_PATH);
  if (!assistantIdleUrl) return;

  document.getElementById(FLOATING_GLASS_ID)?.remove();
  document.getElementById(FLOATING_GLASS_DEFINITIONS_ID)?.remove();
  const liquidFilterId = "model-translator-floating-menu-liquid-filter-v2";
  const liquidMapId = "model-translator-floating-menu-liquid-map-v2";
  const glassDefinitions = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  glassDefinitions.id = FLOATING_GLASS_DEFINITIONS_ID;
  glassDefinitions.setAttribute("width", "0");
  glassDefinitions.setAttribute("height", "0");
  glassDefinitions.style.cssText = "position:fixed;inset:0;pointer-events:none;";
  const liquidDefs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const liquidFilter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  liquidFilter.setAttribute("id", liquidFilterId);
  liquidFilter.setAttribute("filterUnits", "userSpaceOnUse");
  liquidFilter.setAttribute("colorInterpolationFilters", "sRGB");
  const liquidImage = document.createElementNS("http://www.w3.org/2000/svg", "feImage");
  liquidImage.setAttribute("id", liquidMapId);
  const liquidDisplacement = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "feDisplacementMap"
  );
  liquidDisplacement.setAttribute("in", "SourceGraphic");
  liquidDisplacement.setAttribute("in2", liquidMapId);
  liquidDisplacement.setAttribute("xChannelSelector", "R");
  liquidDisplacement.setAttribute("yChannelSelector", "G");
  liquidFilter.append(liquidImage, liquidDisplacement);
  liquidDefs.appendChild(liquidFilter);
  glassDefinitions.appendChild(liquidDefs);

  const floatingGlass = document.createElement("div");
  floatingGlass.id = FLOATING_GLASS_ID;
  floatingGlass.setAttribute("aria-hidden", "true");
  floatingGlass.style.cssText = `
    all: initial;
    position: fixed;
    z-index: 2147483645;
    width: 0;
    height: 0;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.42);
    border-radius: 9px;
    background:
      linear-gradient(
        145deg,
        rgba(255, 255, 255, 0.055),
        rgba(255, 255, 255, 0.01) 54%,
        rgba(184, 220, 255, 0.035)
      ),
      rgba(255, 255, 255, 0.018);
    box-shadow:
      0 10px 24px rgba(15, 23, 42, 0.11),
      inset 0 1px 0 rgba(255, 255, 255, 0.62),
      inset 1px 0 0 rgba(255, 255, 255, 0.18),
      inset 0 -1px 0 rgba(30, 64, 96, 0.11);
    backdrop-filter:
      url(#${liquidFilterId})
      blur(0.25px)
      contrast(1.02)
      brightness(1.075)
      saturate(1.04);
    -webkit-backdrop-filter:
      url(#${liquidFilterId})
      blur(0.25px)
      contrast(1.02)
      brightness(1.075)
      saturate(1.04);
    box-sizing: border-box;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    will-change: left, top, width, height, opacity;
  `;
  document.documentElement.append(glassDefinitions, floatingGlass);

  const host = document.createElement("div");
  host.id = FLOATING_HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const wrapper = document.createElement("div");
  wrapper.className = "floating-wrapper is-right-side";
  wrapper.innerHTML = `
    <div class="floating-cluster">
      <button class="floating-button" type="button" title="小译" aria-label="小译">
        <svg class="floating-assistant-art" viewBox="18 13 92 92" aria-hidden="true">
          <defs>
            <mask id="floating-assistant-star-cutout">
              <rect x="18" y="13" width="92" height="92" fill="#fff"></rect>
              <circle cx="98" cy="40" r="15" fill="#000"></circle>
            </mask>
          </defs>
          <image class="floating-assistant-image" href="${assistantIdleUrl}" x="18" y="13" width="92" height="92" mask="url(#floating-assistant-star-cutout)" data-animation-state="idle"></image>
          <path class="floating-selection-star" d="M98 28l4 8 8 4-8 4-4 8-4-8-8-4 8-4 4-8z" fill="#F59E0B"></path>
        </svg>
      </button>
      <button class="floating-selection-toggle" type="button" data-tip="收起随手划" aria-label="收起随手划" aria-pressed="true"></button>
      <div class="floating-selection-magic" aria-hidden="true">
        <span class="floating-selection-smoke"><i></i><i></i><i></i><i></i><i></i></span>
        <svg class="floating-selection-magnifier" viewBox="0 0 40 40">
          <defs>
            <filter id="floating-selection-shadow" x="-45%" y="-45%" width="205%" height="215%">
              <feDropShadow dx="1.2" dy="1.8" stdDeviation="1.25" flood-color="#334155" flood-opacity=".3"></feDropShadow>
            </filter>
          </defs>
          <g filter="url(#floating-selection-shadow)">
            <circle cx="25" cy="11.5" r="10.5" fill="#dbeafe" fill-opacity=".68" stroke="#409EFF" stroke-width="3.1"></circle>
            <path d="M20.5 21 L15.8 34.2" fill="none" stroke="#64748B" stroke-width="4.3" stroke-linecap="round"></path>
            <path d="M19 6 C21.4 3.6 25 2.7 28 3.8" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" opacity=".94"></path>
          </g>
        </svg>
      </div>
      <button class="floating-dismiss-trigger" type="button" title="让小译先退开" aria-label="让小译先退开">×</button>
      <nav class="floating-menu" aria-label="小译快捷功能">
        <div class="tool-button-page-wrap">
          <button class="tool-button tool-button-primary-page" type="button" data-action="page" data-tip="整页翻译"><span class="ui-icon icon-page" aria-hidden="true"></span></button>
          <button class="page-display-dot" type="button" data-action="display" data-tip="显示格式" data-floating-tip="显示格式" aria-label="显示格式" aria-expanded="false"></button>
          <button class="page-translation-corner page-translation-cancel" type="button" data-page-control="cancel" data-floating-tip="取消翻译" aria-label="取消翻译" hidden><span aria-hidden="true"></span></button>
          <button class="page-translation-corner page-translation-retry" type="button" data-page-control="retry" data-floating-tip="重试失败内容" aria-label="重试失败内容" hidden><span aria-hidden="true"></span></button>
          <div class="page-translation-progress-popover" hidden>
            <strong>完成<span data-progress-completed>0</span></strong>
            <span>待<span data-progress-pending>0</span></span>
            <span class="failure">失败<span data-progress-failed>0</span></span>
          </div>
          <div class="floating-page-display-menu" hidden>
            <button type="button" data-page-display="translated">仅译文</button>
            <button type="button" data-page-display="bilingual">双语显示</button>
          </div>
        </div>
        <button class="tool-button tool-button-primary-self" type="button" data-action="self" data-tip="自助翻译"><span class="ui-icon icon-spark" aria-hidden="true"></span></button>
        <button class="tool-button tool-button-primary-wordbook" type="button" data-action="wordbook" data-tip="单词本"><span class="ui-icon icon-book" aria-hidden="true"></span></button>
        <button class="tool-button tool-button-more" type="button" data-more-trigger data-tip="更多功能" aria-label="更多功能" aria-expanded="false"><span class="ui-icon icon-more" aria-hidden="true"></span></button>
        <button class="tool-button tool-button-overflow" type="button" data-action="history" data-tip="历史记录" style="--more-index: 0" hidden><span class="ui-icon icon-history" aria-hidden="true"></span></button>
        <button class="tool-button tool-button-overflow" type="button" data-action="usage" data-tip="Token 用量" style="--more-index: 1" hidden><span class="ui-icon icon-token" aria-hidden="true"></span></button>
        <button class="tool-button tool-button-overflow" type="button" data-action="settings" data-tip="AI 配置" style="--more-index: 2" hidden><span class="ui-icon icon-gear" aria-hidden="true"></span></button>
      </nav>
      <div class="dismiss-menu" hidden>
        <button type="button" data-dismiss="pause">歇 30 分钟</button>
        <button type="button" data-dismiss="disable">收起小译</button>
      </div>
    </div>
    <section class="floating-panel" hidden>
      <header class="panel-head">
        <h2></h2>
        <div class="panel-controls" hidden>
          <button class="panel-tool panel-pin-toggle" type="button" data-tip="临时置顶" title="临时置顶" aria-label="临时置顶" aria-pressed="false"><span class="panel-tool-icon icon-pin" aria-hidden="true"></span></button>
          <button class="panel-tool panel-opacity-toggle" type="button" data-tip="调节透明度" title="调节透明度" aria-label="调节透明度" aria-expanded="false"><span class="panel-tool-icon icon-opacity" aria-hidden="true"></span></button>
          <div class="panel-opacity-control" hidden><div class="panel-opacity-slider"><span class="panel-opacity-track" aria-hidden="true"></span><input class="panel-opacity-range" type="range" min="${PANEL_OPACITY_MIN}" max="${PANEL_OPACITY_MAX}" value="${PANEL_OPACITY_MAX}" aria-label="窗口透明度" /><span class="panel-opacity-handle" aria-hidden="true"></span><span class="panel-opacity-ticks"><button type="button" data-opacity="${PANEL_OPACITY_MIN}" style="--point-position: 0%" aria-label="低透明度" title="低透明度"></button><button type="button" data-opacity="${PANEL_OPACITY_MID}" style="--point-position: ${((PANEL_OPACITY_MID - PANEL_OPACITY_MIN) / (PANEL_OPACITY_MAX - PANEL_OPACITY_MIN)) * 100}%" aria-label="中透明度" title="中透明度"></button><button type="button" data-opacity="${PANEL_OPACITY_MAX}" style="--point-position: 100%" aria-label="正常透明度" title="正常透明度"></button></span></div></div>
        </div>
        <button class="panel-close" type="button" aria-label="关闭">×</button>
      </header>
      <div class="panel-status" role="status"></div>
      <div class="panel-body"></div>
    </section>
    <div class="floating-action-tooltip" role="tooltip" hidden></div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      position: fixed;
      inset: 0 auto auto 0;
      z-index: 2147483646;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .floating-wrapper {
      pointer-events: none;
    }

    button,
    input,
    select,
    textarea {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .floating-cluster {
      position: fixed;
      top: var(--floating-y, 45vh);
      left: var(--floating-x, calc(100vw - 62px));
      width: 36px;
      height: 36px;
      pointer-events: auto;
    }

    .floating-cluster::before {
      content: "";
      position: absolute;
      left: -16px;
      bottom: 22px;
      width: 70px;
      height: 158px;
      pointer-events: none;
    }

    .floating-cluster:hover::before,
    .floating-cluster:focus-within::before {
      pointer-events: auto;
    }

    .floating-wrapper.is-left-side .floating-cluster::before {
      left: -16px;
    }

    .floating-wrapper.is-near-top .floating-cluster::before {
      top: 22px;
      bottom: auto;
    }

    .floating-button {
      position: relative;
      z-index: 5;
      width: 36px;
      height: 36px;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      cursor: grab;
      pointer-events: auto;
      opacity: 0.62;
      padding: 0;
      transition: transform 160ms ease, opacity 160ms ease;
      -webkit-user-select: none;
      user-select: none;
      touch-action: none;
    }

    .floating-button:hover {
      background: transparent;
      box-shadow: none;
      opacity: 1;
      transform: none;
    }

    .floating-cluster:hover .floating-button,
    .floating-cluster:focus-within .floating-button,
    .floating-cluster:has(.floating-menu.is-pinned) .floating-button,
    .floating-cluster:has(.floating-menu.is-display-pinned) .floating-button {
      opacity: 1;
    }

    .floating-button:active,
    .floating-button.is-dragging {
      cursor: grabbing;
      transform: scale(0.98);
    }

    .floating-assistant-art {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: 0;
      pointer-events: none;
      filter: drop-shadow(0 4px 7px rgba(64, 158, 255, 0.24));
      transform: translateY(1px);
    }

    .floating-selection-star {
      transform-box: fill-box;
      transform-origin: center;
    }

    .floating-cluster.is-selection-toggling .floating-selection-star {
      animation: floatingSelectionStarHop 560ms cubic-bezier(.2, .82, .28, 1.18);
    }

    .floating-cluster.is-assistant-translating:not(.is-selection-toggling) .floating-selection-star {
      animation: floatingSelectionStarSparkle 3.8s ease-out infinite;
    }

    .floating-selection-toggle {
      position: absolute;
      z-index: 8;
      top: 2px;
      right: -1px;
      width: 15px;
      height: 17px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
      pointer-events: auto;
      touch-action: manipulation;
    }

    .floating-selection-toggle::after {
      content: attr(data-tip);
      position: absolute;
      z-index: 12;
      right: -3px;
      bottom: calc(100% + 5px);
      width: max-content;
      max-width: 90px;
      padding: 4px 6px;
      border-radius: 6px;
      background: rgba(31, 41, 55, 0.92);
      color: #fff;
      font-size: 9px;
      font-weight: 600;
      line-height: 1.2;
      opacity: 0;
      pointer-events: none;
      transform: translateY(2px);
      transition: opacity 120ms ease, transform 120ms ease;
      white-space: nowrap;
    }

    .floating-selection-toggle:hover::after,
    .floating-selection-toggle:focus-visible::after {
      opacity: 1;
      transform: translateY(0);
    }

    .floating-selection-toggle:focus-visible {
      outline: none;
    }

    .floating-selection-magic {
      position: absolute;
      z-index: 7;
      top: 14px;
      right: -5px;
      width: 23px;
      height: 23px;
      opacity: 0.62;
      pointer-events: none;
      transition: opacity 160ms ease;
    }

    .floating-cluster:hover .floating-selection-magic,
    .floating-cluster:focus-within .floating-selection-magic,
    .floating-cluster:has(.floating-menu.is-pinned) .floating-selection-magic,
    .floating-cluster:has(.floating-menu.is-display-pinned) .floating-selection-magic {
      opacity: 1;
    }

    .floating-selection-smoke {
      position: absolute;
      inset: 0;
      opacity: 0;
    }

    .floating-selection-smoke i {
      position: absolute;
      display: block;
      border-radius: 50%;
      background: rgba(206, 218, 232, 0.88);
      box-shadow: inset 0 0 4px rgba(255, 255, 255, 0.84), 0 1px 3px rgba(100, 116, 139, 0.13);
    }

    .floating-selection-smoke i:nth-child(1) { left: 7px; top: 8px; width: 9px; height: 9px; }
    .floating-selection-smoke i:nth-child(2) { left: 2px; top: 11px; width: 8px; height: 8px; }
    .floating-selection-smoke i:nth-child(3) { left: 13px; top: 4px; width: 7px; height: 7px; }
    .floating-selection-smoke i:nth-child(4) { left: 14px; top: 13px; width: 8px; height: 8px; }
    .floating-selection-smoke i:nth-child(5) { left: 6px; top: 2px; width: 6px; height: 6px; }

    .floating-cluster.is-selection-toggling .floating-selection-smoke {
      animation: floatingSelectionSmoke 760ms ease-out;
    }

    .floating-selection-magnifier {
      position: absolute;
      right: 1px;
      bottom: 2px;
      width: 16px;
      height: 16px;
      opacity: 0;
      transform: translate(1px, 2px) rotate(-10deg) scale(0.35);
      transform-origin: 48% 54%;
    }

    .floating-cluster.is-selection-enabled .floating-selection-magnifier {
      opacity: 1;
      transform: translate(0, 0) rotate(0) scale(1);
    }

    .floating-cluster.is-selection-toggling.is-selection-enabled .floating-selection-magnifier {
      animation: floatingSelectionMagnifierIn 720ms cubic-bezier(.18, .9, .2, 1.22);
    }

    .floating-cluster.is-selection-toggling:not(.is-selection-enabled) .floating-selection-magnifier {
      animation: floatingSelectionMagnifierOut 620ms ease-in forwards;
    }

    .floating-dismiss-trigger {
      position: absolute;
      z-index: 6;
      left: -5px;
      bottom: -8px;
      width: 16px;
      height: 16px;
      border: 0;
      border-radius: 999px;
      background: rgba(100, 116, 139, 0.5);
      color: #ffffff;
      cursor: pointer;
      font-size: 0;
      line-height: 0;
      padding: 0;
      box-shadow: 0 5px 12px rgba(15, 23, 42, 0.12);
      opacity: 0;
      pointer-events: none;
      transition: opacity 140ms ease, transform 140ms ease, background 140ms ease;
    }

    .floating-dismiss-trigger::before,
    .floating-dismiss-trigger::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 50%;
      width: 7px;
      height: 1.25px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.92);
    }

    .floating-dismiss-trigger::before {
      transform: translate(-50%, -50%) rotate(45deg);
    }

    .floating-dismiss-trigger::after {
      transform: translate(-50%, -50%) rotate(-45deg);
    }

    .floating-dismiss-trigger:hover {
      background: rgba(100, 116, 139, 0.66);
      transform: scale(1.06);
    }

    .floating-cluster:hover .floating-dismiss-trigger,
    .floating-cluster:focus-within .floating-dismiss-trigger,
    .floating-dismiss-trigger.is-open {
      opacity: 1;
      pointer-events: auto;
    }

    .floating-menu {
      --menu-motion-duration: 190ms;
      --menu-motion-curve: cubic-bezier(0.4, 0, 0.2, 1);
      position: absolute;
      z-index: 1;
      left: 50%;
      bottom: 32px;
      display: flex;
      flex-direction: column-reverse;
      gap: 2px;
      padding: 5px 4px;
      border: 1px solid transparent;
      border-radius: 9px;
      background: transparent;
      box-shadow: none;
      box-sizing: border-box;
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, 14px) scale(0.86);
      transform-origin: center bottom;
      transition: opacity 150ms ease, transform var(--menu-motion-duration) var(--menu-motion-curve);
    }

    .floating-menu.is-more-animating {
      overflow: hidden;
      will-change: height;
      transition: height 360ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 150ms ease, transform 150ms ease;
    }

    .floating-wrapper.is-left-side .floating-menu {
      left: 50%;
      transform: translate(-50%, 14px) scale(0.86);
    }

    .floating-wrapper.is-near-top .floating-menu {
      top: 32px;
      bottom: auto;
      flex-direction: column;
      transform: translate(-50%, -14px) scale(0.86);
      transform-origin: center top;
    }

    .floating-cluster:hover .floating-menu,
    .floating-cluster:focus-within .floating-menu,
    .floating-menu.is-pinned,
    .floating-menu.is-display-pinned {
      --menu-motion-duration: 410ms;
      --menu-motion-curve: cubic-bezier(0.16, 1.42, 0.3, 1);
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, -10px) scale(1);
    }

    .floating-wrapper.is-near-top .floating-cluster:hover .floating-menu,
    .floating-wrapper.is-near-top .floating-cluster:focus-within .floating-menu,
    .floating-wrapper.is-near-top .floating-menu.is-pinned,
    .floating-wrapper.is-near-top .floating-menu.is-display-pinned {
      transform: translate(-50%, 10px) scale(1);
    }

    .tool-button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 26px;
      width: 26px;
      min-width: 26px;
      height: 26px;
      min-height: 26px;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: #1f2937;
      box-shadow: none;
      cursor: pointer;
      font-size: 13px;
      font-weight: 800;
      line-height: 1;
      transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
    }

    .tool-button-page-wrap {
      position: relative;
      flex: 0 0 26px;
      width: 26px;
      height: 26px;
      overflow: visible;
    }

    .tool-button-page-wrap .tool-button {
      width: 100%;
      height: 100%;
    }

    .tool-button-more[hidden],
    .tool-button-overflow[hidden] {
      display: none;
    }

    .tool-button-overflow {
      --more-shift: 11px;
    }

    .floating-wrapper.is-near-top .tool-button-overflow {
      --more-shift: -11px;
    }

    .floating-menu.is-more-expanding .tool-button-overflow {
      animation: floatingMoreSpringIn 390ms cubic-bezier(0.22, 1.35, 0.36, 1) both;
      animation-delay: calc(var(--more-index) * 34ms);
    }

    .floating-menu.is-more-collapsing .tool-button-overflow {
      animation: floatingMoreSpringOut 240ms cubic-bezier(0.4, 0, 0.6, 1) both;
      animation-delay: calc((2 - var(--more-index)) * 18ms);
    }

    @keyframes floatingMoreSpringIn {
      0% {
        opacity: 0;
        transform: translateY(var(--more-shift));
      }
      62% {
        opacity: 1;
        transform: translateY(calc(var(--more-shift) * -0.14));
      }
      82% {
        transform: translateY(calc(var(--more-shift) * 0.05));
      }
      100% {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes floatingMoreSpringOut {
      0% {
        opacity: 1;
        transform: translateY(0);
      }
      35% {
        transform: translateY(calc(var(--more-shift) * -0.08));
      }
      100% {
        opacity: 0;
        transform: translateY(var(--more-shift));
      }
    }

    .page-display-dot {
      position: absolute;
      z-index: 3;
      top: -2px;
      left: -2px;
      width: 10px;
      height: 10px;
      padding: 0;
      border: 2px solid rgba(255, 255, 255, 0.95);
      border-radius: 999px;
      background: #409eff;
      box-shadow: 0 1px 4px rgba(37, 99, 235, 0.32);
      cursor: pointer;
      transition: transform 140ms ease, background 140ms ease, box-shadow 140ms ease;
    }

    .page-display-dot.is-bilingual {
      background: #67c23a;
      box-shadow: 0 1px 4px rgba(103, 194, 58, 0.32);
    }

    .page-display-dot:hover,
    .page-display-dot[aria-expanded="true"] {
      box-shadow: 0 2px 6px rgba(37, 99, 235, 0.4);
    }

    .page-display-dot.is-bilingual:hover,
    .page-display-dot.is-bilingual[aria-expanded="true"] {
      box-shadow: 0 2px 6px rgba(103, 194, 58, 0.42);
    }

    .page-display-dot::after {
      content: none;
    }

    .page-translation-corner {
      position: absolute;
      z-index: 4;
      display: grid;
      width: 10px;
      height: 10px;
      padding: 0;
      place-items: center;
      border: 1.5px solid rgba(255, 255, 255, 0.96);
      border-radius: 999px;
      color: #ffffff;
      cursor: pointer;
      line-height: 1;
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.18);
      transition: transform 140ms ease, filter 140ms ease;
    }

    .page-translation-corner[hidden] {
      display: none;
    }

    .page-translation-corner:hover {
      filter: brightness(1.05);
      transform: scale(1.16);
    }

    .page-translation-corner span::before {
      display: block;
      font-size: 7px;
      font-weight: 800;
      line-height: 1;
    }

    .page-translation-cancel {
      top: -2px;
      right: -2px;
      background: #f56c6c;
    }

    .page-translation-cancel span::before {
      content: "×";
    }

    .page-translation-retry {
      right: -2px;
      bottom: -2px;
      background: #e6a23c;
    }

    .page-translation-retry.is-page-retranslate {
      top: -2px;
      bottom: auto;
    }

    .page-translation-retry span::before {
      content: "↻";
    }

    .page-translation-retry.is-retrying {
      animation: pageRetryTurn 420ms ease;
    }

    @keyframes pageRetryTurn {
      to { transform: rotate(360deg); }
    }

    .page-translation-progress-popover {
      position: absolute;
      z-index: 7;
      top: 50%;
      right: 34px;
      display: flex;
      align-items: center;
      width: max-content;
      padding: 4px;
      gap: 5px;
      border: 1px solid rgba(207, 218, 230, 0.98);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.97);
      color: #64748b;
      box-shadow: 0 8px 18px rgba(51, 65, 85, 0.13);
      font-size: 9px;
      line-height: 1;
      opacity: 0;
      pointer-events: none;
      transform: translate(4px, -50%) scale(0.98);
      transform-origin: right center;
      transition: opacity 130ms ease, transform 150ms ease;
      white-space: nowrap;
    }

    .page-translation-progress-popover[hidden] {
      display: none;
    }

    .page-translation-progress-popover strong {
      color: #409eff;
      font-size: 9px;
      font-weight: 700;
    }

    .page-translation-progress-popover .failure {
      color: #f56c6c;
    }

    .tool-button-page-wrap.is-translating:hover .page-translation-progress-popover,
    .tool-button-page-wrap.is-translating:focus-within .page-translation-progress-popover {
      opacity: 1;
      transform: translate(0, -50%) scale(1);
    }

    .floating-wrapper.is-left-side .page-translation-progress-popover {
      right: auto;
      left: 34px;
      transform: translate(-4px, -50%) scale(0.98);
      transform-origin: left center;
    }

    .floating-wrapper.is-left-side .tool-button-page-wrap.is-translating:hover .page-translation-progress-popover,
    .floating-wrapper.is-left-side .tool-button-page-wrap.is-translating:focus-within .page-translation-progress-popover {
      transform: translate(0, -50%) scale(1);
    }

    .floating-page-display-menu {
      position: absolute;
      z-index: 5;
      top: 0;
      right: 33px;
      bottom: auto;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      width: 112px;
      gap: 2px;
      padding: 3px;
      border: 1px solid rgba(214, 229, 245, 0.95);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.88);
      box-shadow: 0 7px 16px rgba(15, 23, 42, 0.14);
    }

    .floating-page-display-menu[hidden] {
      display: none;
    }

    .floating-page-display-menu button {
      min-height: 22px;
      padding: 0 5px;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      font: 600 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center;
      transition: background 120ms ease, color 120ms ease;
      white-space: nowrap;
    }

    .floating-page-display-menu button:hover,
    .floating-page-display-menu button.is-selected {
      background: #ecf5ff;
      color: #2563eb;
    }

    .floating-wrapper.is-left-side .floating-page-display-menu {
      right: auto;
      left: 33px;
    }

    .ui-icon {
      display: inline-flex;
      width: 13px;
      height: 13px;
      background-color: currentColor;
      mask-position: center;
      mask-repeat: no-repeat;
      mask-size: 13px 13px;
      -webkit-mask-position: center;
      -webkit-mask-repeat: no-repeat;
      -webkit-mask-size: 13px 13px;
    }

    .icon-gear {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A8 8 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A8 8 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z'/%3E%3C/svg%3E");
    }

    .icon-spark {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z'/%3E%3C/svg%3E");
    }

    .icon-page {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' d='M6 7h12M6 12h12M6 17h8'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' d='M6 7h12M6 12h12M6 17h8'/%3E%3C/svg%3E");
    }

    .icon-bilingual {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M4 5h7m-3.5 0c0 6-2.2 10-4.5 12m2-5h5m4-7h6m-3 0v14m-3-4h6'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M4 5h7m-3.5 0c0 6-2.2 10-4.5 12m2-5h5m4-7h6m-3 0v14m-3-4h6'/%3E%3C/svg%3E");
    }

    .icon-restore {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round' d='M7 8H4V5m.4 3A8 8 0 1 1 4 15'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round' d='M7 8H4V5m.4 3A8 8 0 1 1 4 15'/%3E%3C/svg%3E");
    }

    .icon-resume {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='M8 5.5v13L18 12 8 5.5Z'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='M8 5.5v13L18 12 8 5.5Z'/%3E%3C/svg%3E");
    }

    .icon-history {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round' d='M12 7v5l3 2M5 7H2V4m.6 3A9 9 0 1 1 3 16'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round' d='M12 7v5l3 2M5 7H2V4m.6 3A9 9 0 1 1 3 16'/%3E%3C/svg%3E");
    }

    .icon-book {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.15' stroke-linecap='round' stroke-linejoin='round' d='M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21V5.5Zm16 0A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21V5.5Z'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.15' stroke-linecap='round' stroke-linejoin='round' d='M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21V5.5Zm16 0A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21V5.5Z'/%3E%3C/svg%3E");
    }

    .icon-token {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='M4 5h7v7H4V5Zm9 0h7v7h-7V5ZM4 14h7v5H4v-5Zm9 0h7v5h-7v-5Z'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='M4 5h7v7H4V5Zm9 0h7v7h-7V5ZM4 14h7v5H4v-5Zm9 0h7v5h-7v-5Z'/%3E%3C/svg%3E");
    }

    .icon-more {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='5' cy='12' r='2' fill='black'/%3E%3Ccircle cx='12' cy='12' r='2' fill='black'/%3E%3Ccircle cx='19' cy='12' r='2' fill='black'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='5' cy='12' r='2' fill='black'/%3E%3Ccircle cx='12' cy='12' r='2' fill='black'/%3E%3Ccircle cx='19' cy='12' r='2' fill='black'/%3E%3C/svg%3E");
    }

    .ui-icon.icon-gear {
      mask-size: 12.5px 12.5px;
      -webkit-mask-size: 12.5px 12.5px;
    }

    .ui-icon.icon-spark {
      mask-size: 12px 12px;
      -webkit-mask-size: 12px 12px;
    }

    .ui-icon.icon-page {
      mask-size: 16.5px 16.5px;
      -webkit-mask-size: 16.5px 16.5px;
    }

    .ui-icon.icon-restore,
    .ui-icon.icon-bilingual {
      mask-size: 12px 12px;
      -webkit-mask-size: 12px 12px;
    }

    .ui-icon.icon-history,
    .ui-icon.icon-book {
      mask-size: 11.5px 11.5px;
      -webkit-mask-size: 11.5px 11.5px;
    }

    .ui-icon.icon-token {
      mask-size: 15.5px 15.5px;
      -webkit-mask-size: 15.5px 15.5px;
    }

    .ui-icon.icon-more {
      mask-size: 14px 14px;
      -webkit-mask-size: 14px 14px;
    }

    .tool-button:hover {
      border-color: #b3d8ff;
      background: #ecf5ff;
      color: #409eff;
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(64, 158, 255, 0.13);
    }

    .tool-button:active:not(:disabled) {
      transform: translateY(0) scale(0.94);
    }

    .tool-button-primary-page {
      background: #ecf5ff;
      color: #409eff;
    }

    .tool-button-primary-self {
      background: #f0f9f4;
      color: #27a35c;
    }

    .tool-button-primary-wordbook {
      background: #fdf6ec;
      color: #d99a2b;
    }

    .tool-button-primary-page:hover {
      background: #d9ecff;
      color: #337ecc;
    }

    .tool-button-primary-self:hover {
      background: #e1f3e8;
      color: #1f8b4c;
    }

    .tool-button-primary-wordbook:hover {
      background: #faecd8;
      color: #c98718;
    }

    .tool-button.is-busy {
      cursor: wait;
      opacity: 0.72;
    }

    .tool-button.is-busy .ui-icon {
      opacity: 0;
    }

    .tool-button.is-busy::before {
      content: "";
      position: absolute;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(64, 158, 255, 0.26);
      border-top-color: #409eff;
      border-radius: 999px;
      animation: floatingButtonSpin 760ms linear infinite;
    }

    @keyframes floatingButtonSpin {
      to {
        transform: rotate(360deg);
      }
    }

    .tool-button-primary-page.is-page-progress {
      --page-progress: 0%;
      isolation: isolate;
      overflow: visible;
      background: #dfeaf5;
      color: #ffffff;
      cursor: pointer;
      opacity: 1;
    }

    .tool-button-primary-page.is-page-progress::before {
      content: none;
    }

    .tool-button-primary-page.is-page-progress .ui-icon {
      position: relative;
      z-index: 3;
      opacity: 1;
      filter: drop-shadow(0 1px 1px rgba(51, 65, 85, 0.22));
    }

    .page-progress-fill,
    .page-progress-waiting {
      position: absolute;
      z-index: 1;
      top: 0;
      bottom: 0;
      pointer-events: none;
    }

    .page-progress-fill {
      left: 0;
      width: var(--page-progress);
      border-radius: 9px 0 0 9px;
      background: #409eff;
      transition: width 420ms cubic-bezier(0.22, 0.82, 0.32, 1);
    }

    .page-progress-waiting {
      right: 0;
      left: var(--page-progress);
      overflow: hidden;
      border-radius: 0 9px 9px 0;
      background:
        linear-gradient(110deg, transparent 0 20%, rgba(255, 255, 255, 0.58) 38%, transparent 54% 100%),
        repeating-linear-gradient(120deg, rgba(255, 255, 255, 0.05) 0 5px, rgba(145, 170, 196, 0.1) 5px 10px);
      background-size: 54px 100%, auto;
      animation: pageWaitingFlow 1.35s linear infinite;
      transition: left 420ms cubic-bezier(0.22, 0.82, 0.32, 1);
    }

    .tool-button-primary-page.is-page-progress.is-paused .page-progress-waiting {
      animation-play-state: paused;
      opacity: 0.58;
    }

    @keyframes pageWaitingFlow {
      from { background-position: -54px 0, 0 0; }
      to { background-position: 54px 0, 0 0; }
    }

    .tool-button::after {
      content: attr(data-tip);
      position: absolute;
      top: 50%;
      right: 42px;
      width: max-content;
      max-width: 120px;
      padding: 3px 6px;
      border-radius: 5px;
      background: rgba(15, 23, 42, 0.88);
      color: #ffffff;
      font-size: 11px;
      font-weight: 400;
      line-height: 1.2;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-50%) translateX(4px);
      transition: opacity 120ms ease, transform 120ms ease;
    }

    .floating-wrapper.is-left-side .tool-button::after {
      right: auto;
      left: 42px;
      transform: translateY(-50%) translateX(-4px);
    }

    .tool-button:hover::after {
      opacity: 1;
      transform: translateY(-50%) translateX(0);
    }

    .tool-button[data-floating-tip]::after {
      content: none;
    }

    .floating-action-tooltip {
      position: fixed;
      z-index: 100;
      width: max-content;
      max-width: 120px;
      padding: 3px 6px;
      border-radius: 5px;
      background: rgba(15, 23, 42, 0.9);
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.16);
      font-size: 10px;
      font-weight: 400;
      line-height: 1.2;
      opacity: 0;
      pointer-events: none;
      transform: translateY(2px);
      transition: opacity 120ms ease, transform 120ms ease;
      white-space: nowrap;
    }

    .floating-action-tooltip.is-visible {
      opacity: 1;
      transform: translateY(0);
    }

    .floating-action-tooltip[hidden] {
      display: none;
    }

    .dismiss-menu {
      position: absolute;
      z-index: 4;
      right: 28px;
      left: auto;
      bottom: -57px;
      display: grid;
      gap: 0;
      width: max-content;
      padding: 4px;
      border: 1px solid rgba(15, 23, 42, 0.14);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.88);
      box-shadow: 0 10px 26px rgba(15, 23, 42, 0.16);
      pointer-events: auto;
    }

    .floating-wrapper.is-left-side .dismiss-menu {
      left: 28px;
      right: auto;
    }

    .dismiss-menu[hidden] {
      display: none;
    }

    .dismiss-menu button {
      min-height: 26px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #1f2937;
      cursor: pointer;
      font-size: 11px;
      text-align: left;
      white-space: nowrap;
      padding: 0 7px;
    }

    .dismiss-menu button:first-child {
      padding-right: 17px;
    }

    .dismiss-menu button:hover {
      background: #f4f9ff;
      color: #2563eb;
    }

    .floating-panel {
      position: fixed;
      top: var(--panel-y, 18px);
      left: var(--panel-x, calc(100vw - 374px));
      width: 320px;
      max-height: min(520px, calc(100vh - 28px));
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 19px;
      background: rgb(255 255 255 / var(--panel-background-opacity, 0.9));
      box-shadow: 0 18px 46px rgba(15, 23, 42, 0.18);
      overflow: auto;
      pointer-events: auto;
      box-sizing: border-box;
      padding: 10px;
      animation: floatingPanelIn 180ms ease both;
      color: #111827;
    }

    .panel-head h2,
    .panel-close,
    .panel-status,
    .panel-body {
      opacity: var(--panel-content-opacity, 1);
      transition: opacity 120ms ease;
    }

    .floating-panel[hidden] {
      display: none;
    }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 4px;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }

    .panel-head.is-dragging {
      cursor: grabbing;
    }

    .panel-head h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 800;
      color: #1f2937;
    }

    .panel-controls {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }

    .panel-tool {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      transition: transform 140ms ease, background 140ms ease, color 140ms ease;
    }

    .panel-tool:hover {
      background: #ecf5ff;
      color: #409eff;
      transform: translateY(-1px);
    }

    .panel-tool:active {
      transform: scale(0.94);
    }

    .panel-tool[hidden] {
      display: none;
    }

    .panel-tool.is-active {
      background: #ecf5ff;
      color: #409eff;
      box-shadow: inset 0 0 0 1px rgba(64, 158, 255, 0.14);
    }

    .panel-tool-icon {
      display: inline-flex;
      width: 13px;
      height: 13px;
      background-color: currentColor;
      mask-position: center;
      mask-repeat: no-repeat;
      mask-size: 13px 13px;
      -webkit-mask-position: center;
      -webkit-mask-repeat: no-repeat;
      -webkit-mask-size: 13px 13px;
    }

    .icon-pin {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='M9 3h6v5l3 3v2h-5v8h-2v-8H6v-2l3-3V3Zm2 2v3.8L8.8 11h6.4L13 8.8V5h-2Z'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='M9 3h6v5l3 3v2h-5v8h-2v-8H6v-2l3-3V3Zm2 2v3.8L8.8 11h6.4L13 8.8V5h-2Z'/%3E%3C/svg%3E");
    }

    .icon-opacity {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' d='M12 3s6 6.2 6 11a6 6 0 1 1-12 0c0-4.8 6-11 6-11Zm-3 11h6'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' d='M12 3s6 6.2 6 11a6 6 0 1 1-12 0c0-4.8 6-11 6-11Zm-3 11h6'/%3E%3C/svg%3E");
    }

    .panel-opacity-control {
      position: absolute;
      z-index: 3;
      top: 30px;
      right: 38px;
      width: 96px;
      padding: 7px 9px;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 9px 22px rgba(15, 23, 42, 0.14);
    }

    .panel-opacity-slider {
      position: relative;
      height: 14px;
      touch-action: none;
    }

    .panel-opacity-range {
      position: absolute;
      z-index: 1;
      inset: 0;
      width: 100%;
      height: 14px;
      margin: 0;
      opacity: 0;
      pointer-events: none;
    }

    .panel-opacity-track {
      position: absolute;
      inset: 6px 0 auto;
      height: 2px;
      border-radius: 999px;
      background: #bfdcff;
    }

    .panel-opacity-handle {
      position: absolute;
      z-index: 4;
      top: 2px;
      left: var(--opacity-position, 100%);
      width: 10px;
      height: 10px;
      border: 2px solid #ffffff;
      border-radius: 50%;
      background: #409eff;
      box-sizing: border-box;
      box-shadow: 0 1px 4px rgba(64, 158, 255, 0.38);
      cursor: grab;
      pointer-events: auto;
      transform: translateX(-50%);
    }

    .panel-opacity-slider:active .panel-opacity-handle {
      cursor: grabbing;
    }

    .panel-opacity-ticks {
      position: absolute;
      z-index: 3;
      inset: 0;
      pointer-events: none;
    }

    .panel-opacity-ticks button {
      width: 6px;
      height: 6px;
      padding: 0;
      position: absolute;
      top: 4px;
      left: var(--point-position);
      border: 1px solid #8fc2f8;
      border-radius: 50%;
      background: #ffffff;
      box-sizing: border-box;
      cursor: pointer;
      pointer-events: auto;
      opacity: 0.95;
      transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
      transform: translateX(-50%);
    }

    .panel-opacity-ticks button:hover,
    .panel-opacity-ticks button:focus-visible {
      border-color: #409eff;
      background: #409eff;
      box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.15);
      outline: none;
      transform: translateX(-50%) scale(1.65);
    }

    .panel-close {
      width: 28px;
      height: 28px;
      cursor: pointer;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #ffffff;
      color: #64748b;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
    }

    .panel-close:hover {
      border-color: #fca5a5;
      background: #fff5f5;
      color: #dc2626;
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(239, 68, 68, 0.12);
    }

    .panel-close:active {
      transform: translateY(0) scale(0.94);
    }

    .panel-status {
      margin-bottom: 5px;
      color: #166534;
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .panel-status:empty {
      display: none;
    }

    .panel-status[data-state="error"] {
      color: #b91c1c;
    }

    .panel-body {
      display: grid;
      gap: 9px;
    }

    .field {
      display: grid;
      gap: 5px;
      color: #374151;
      font-size: 11px;
      font-weight: 650;
    }

    .api-key-field {
      position: relative;
    }

    .api-key-tip {
      position: absolute;
      z-index: 2;
      top: calc(100% + 5px);
      left: 0;
      width: max-content;
      max-width: 276px;
      padding: 5px 7px;
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 7px 18px rgba(15, 23, 42, 0.12);
      color: #64748b;
      font-size: 10px;
      font-weight: 500;
      line-height: 1.4;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-3px);
      transition: opacity 140ms ease, transform 140ms ease;
    }

    .api-key-field:hover .api-key-tip,
    .api-key-field:focus-within .api-key-tip {
      opacity: 1;
      transform: translateY(0);
    }

    .row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 7px;
      align-items: center;
    }

    .translate-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 30px minmax(0, 1fr) 56px;
      align-items: center;
      gap: 6px;
    }

    .swap-button {
      width: 30px;
      height: 30px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #409eff;
      cursor: pointer;
      box-shadow: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: color 140ms ease, background 140ms ease;
    }

    .swap-button:hover {
      background: rgba(64, 158, 255, 0.1);
      color: #337ecc;
    }

    .swap-icon {
      position: relative;
      display: block;
      width: 13px;
      height: 12px;
      color: currentColor;
    }

    .swap-icon-line {
      position: absolute;
      left: 1px;
      width: 9px;
      height: 1.5px;
      border-radius: 999px;
      background: currentColor;
    }

    .swap-icon-line::after {
      content: "";
      position: absolute;
      top: -2.75px;
      width: 0;
      height: 0;
      border-top: 3.5px solid transparent;
      border-bottom: 3.5px solid transparent;
    }

    .swap-icon-top {
      top: 3px;
    }

    .swap-icon-top::after {
      right: -2px;
      border-left: 4px solid currentColor;
    }

    .swap-icon-bottom {
      bottom: 3px;
      left: 3px;
    }

    .swap-icon-bottom::after {
      left: -2px;
      border-right: 4px solid currentColor;
    }

    .swap-button.is-swapping .swap-icon {
      animation: floatingSwapFlip 340ms cubic-bezier(0.2, 0.8, 0.25, 1);
    }

    input,
    select,
    textarea {
      box-sizing: border-box;
      width: 100%;
      border: 1px solid #d8dee8;
      border-radius: 12px;
      background: #ffffff;
      color: #111827;
      font-size: 12px;
    }

    input,
    select {
      height: 32px;
      padding: 0 10px;
    }

    textarea {
      min-height: 92px;
      resize: vertical;
      padding: 9px 10px;
      line-height: 1.45;
    }

    input:focus,
    select:focus,
    textarea:focus {
      border-color: #95d5b2;
      box-shadow: 0 0 0 3px rgba(149, 213, 178, 0.2);
      outline: none;
    }

    .primary,
    .soft,
    .danger {
      min-height: 32px;
      border: 0;
      border-radius: 11px;
      cursor: pointer;
      padding: 0 12px;
      font-size: 12px;
      font-weight: 750;
      white-space: nowrap;
      transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
    }

    .primary {
      background: #409eff;
      color: #ffffff;
      box-shadow: 0 7px 15px rgba(64, 158, 255, 0.18);
    }

    .primary:hover:not(:disabled) {
      background: #66b1ff;
      transform: translateY(-1px);
      box-shadow: 0 9px 18px rgba(64, 158, 255, 0.28);
    }

    #floatingSelfTranslate {
      padding: 0 6px;
    }

    .soft {
      border: 1px solid #d8dee8;
      background: #ffffff;
      color: #64748b;
      box-shadow: none;
    }

    .danger {
      border: 1px solid #fecaca;
      background: #fff7f7;
      color: #dc2626;
      box-shadow: none;
    }

    .soft:hover:not(:disabled) {
      border-color: #b3d8ff;
      background: #f4f9ff;
      color: #2563eb;
      transform: translateY(-1px);
      box-shadow: 0 5px 12px rgba(64, 158, 255, 0.12);
    }

    .danger:hover:not(:disabled) {
      border-color: #ef4444;
      background: #fff1f2;
      color: #dc2626;
      transform: translateY(-1px);
      box-shadow: 0 5px 12px rgba(239, 68, 68, 0.13);
    }

    .primary:active:not(:disabled),
    .soft:active:not(:disabled),
    .danger:active:not(:disabled) {
      transform: translateY(0) scale(0.98);
    }

    .result-wrap {
      position: relative;
    }

    .copy-mini {
      position: absolute;
      top: 7px;
      right: 7px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      min-width: 26px;
      height: 26px;
      min-height: 26px;
      border: 1px solid #d8dee8;
      border-radius: 8px;
      background: #ffffff;
      color: #64748b;
      cursor: pointer;
      padding: 0;
      transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease;
    }

    .copy-mini:hover:not(:disabled) {
      border-color: #b3d8ff;
      background: #f4f9ff;
      color: #2563eb;
      transform: translateY(-1px);
    }

    .copy-mini:active:not(:disabled) {
      transform: translateY(0) scale(0.94);
    }

    .copy-mini[data-tip]::after {
      content: attr(data-tip);
      position: absolute;
      z-index: 3;
      top: calc(100% + 5px);
      right: 0;
      padding: 4px 6px;
      border-radius: 6px;
      background: rgba(15, 23, 42, 0.9);
      color: #ffffff;
      font-size: 9px;
      line-height: 1.2;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-2px);
      transition: opacity 120ms ease, transform 120ms ease;
      white-space: nowrap;
    }

    .copy-mini[data-tip]:hover::after,
    .copy-mini[data-tip]:focus-visible::after {
      opacity: 1;
      transform: translateY(0);
    }

    .copy-icon {
      display: inline-block;
      width: 14px;
      height: 14px;
      background: currentColor;
      mask: center / 14px 14px no-repeat url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='8.25' y='8.25' width='10.5' height='10.5' rx='1.75' fill='none' stroke='black' stroke-width='1.8'/%3E%3Cpath d='M15.75 8.25V6.5A1.5 1.5 0 0 0 14.25 5H6.5A1.5 1.5 0 0 0 5 6.5v7.75a1.5 1.5 0 0 0 1.5 1.5h1.75' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E");
      -webkit-mask: center / 14px 14px no-repeat url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='8.25' y='8.25' width='10.5' height='10.5' rx='1.75' fill='none' stroke='black' stroke-width='1.8'/%3E%3Cpath d='M15.75 8.25V6.5A1.5 1.5 0 0 0 14.25 5H6.5A1.5 1.5 0 0 0 5 6.5v7.75a1.5 1.5 0 0 0 1.5 1.5h1.75' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E");
    }

    .result-wrap textarea,
    .floating-learning-result {
      padding-right: 44px;
      background: #f8fafc;
    }

    .floating-learning-result {
      box-sizing: border-box;
      width: 100%;
      min-height: 92px;
      overflow: auto;
      padding: 9px 54px 9px 10px;
      border: 1px solid #d8dee8;
      border-radius: 12px;
      color: #111827;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .floating-learning-result:empty::before {
      content: attr(data-placeholder);
      color: #94a3b8;
    }

    .floating-learning-source {
      margin-bottom: 7px;
      padding-bottom: 7px;
      border-bottom: 1px solid #e5eaf2;
      color: #64748b;
      font-size: 11px;
    }

    .floating-learning-result.is-word-result {
      position: relative;
      min-height: 120px;
      padding: 10px;
      white-space: normal;
    }

    .inline-word-head {
      min-height: 48px;
      padding-right: 68px;
    }

    .inline-word-language {
      color: #64748b;
      font-size: 10px;
    }

    .inline-word-title {
      margin-top: 2px;
      color: #e88b2d;
      font-size: 19px;
      font-weight: 800;
      line-height: 1.2;
    }

    .inline-word-meta {
      margin-top: 3px;
      color: #64748b;
      font-size: 10px;
    }

    .inline-word-section {
      margin-top: 10px;
    }

    .inline-word-label {
      color: #8b5cf6;
      font-size: 10px;
    }

    .inline-word-value,
    .inline-word-meanings {
      margin: 3px 0 0;
      color: #475569;
      font-size: 11px;
      line-height: 1.5;
    }

    .inline-word-meanings {
      padding-left: 16px;
      color: #2563eb;
    }

    .inline-word-value.is-example {
      color: #64748b;
      font-style: italic;
    }

    .inline-word-favorite {
      position: absolute;
      top: 7px;
      right: 39px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      min-width: 26px;
      height: 26px;
      min-height: 26px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 8px;
      background: #ffffff;
      color: #64748b;
      box-shadow: none;
      cursor: pointer;
      transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease;
    }

    .inline-word-favorite:hover,
    .inline-word-favorite.is-active {
      border-color: #b3d8ff;
      background: #ecf5ff;
      color: #409eff;
    }

    .inline-word-favorite:active {
      transform: scale(0.9);
    }

    .inline-word-favorite[data-tip]::after {
      content: attr(data-tip);
      position: absolute;
      z-index: 3;
      top: calc(100% + 5px);
      right: 0;
      padding: 4px 6px;
      border-radius: 6px;
      background: rgba(15, 23, 42, 0.9);
      color: #ffffff;
      font-size: 9px;
      line-height: 1.2;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-2px);
      transition: opacity 120ms ease, transform 120ms ease;
      white-space: nowrap;
    }

    .inline-word-favorite[data-tip]:hover::after,
    .inline-word-favorite[data-tip]:focus-visible::after {
      opacity: 1;
      transform: translateY(0);
    }

    .inline-word-star {
      width: 14px;
      height: 14px;
      background: currentColor;
      mask: center / 13px 13px no-repeat url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.2' stroke-linejoin='round' d='m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.7l6.2-.9L12 3Z'/%3E%3C/svg%3E");
      -webkit-mask: center / 13px 13px no-repeat url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.2' stroke-linejoin='round' d='m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.7l6.2-.9L12 3Z'/%3E%3C/svg%3E");
    }

    .inline-word-star.is-filled {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='m12 2.8 2.9 5.9 6.5.9-4.7 4.5 1.1 6.4-5.8-3.1-5.8 3.1 1.1-6.4-4.7-4.5 6.5-.9L12 2.8Z'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='m12 2.8 2.9 5.9 6.5.9-4.7 4.5 1.1 6.4-5.8-3.1-5.8 3.1 1.1-6.4-4.7-4.5 6.5-.9L12 2.8Z'/%3E%3C/svg%3E");
    }

    .floating-learn-word {
      display: inline;
      margin: 0;
      padding: 0 1px;
      border: 0;
      border-radius: 3px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      line-height: inherit;
    }

    .floating-learn-word:hover {
      background: #ecf5ff;
      color: #409eff;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .empty {
      padding: 18px 10px;
      color: #94a3b8;
      font-size: 12px;
      text-align: center;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 2px;
    }

    .toolbar select {
      flex: 0 0 86px;
      width: 96px;
      height: 26px;
      padding: 0 7px;
      border-radius: 8px;
      color: #64748b;
      font-size: 10px;
    }

    .toolbar .history-search {
      flex: 1 1 auto;
      min-width: 0;
      height: 26px;
      padding: 0 8px;
      border-radius: 8px;
      color: #64748b;
      font-size: 10px;
    }

    .toolbar .danger {
      min-height: 26px;
      padding: 0 8px;
      font-size: 10px;
    }

    .history-item {
      display: grid;
      gap: 5px;
      padding: 8px;
      border: 1px solid #eef2f7;
      border-radius: 12px;
      background: #fbfdff;
      cursor: default;
      margin-bottom: 5px;
    }

    .history-item:hover {
      border-color: #dbeafe;
      background: #f8fbff;
    }

    .item-meta,
    .history-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
      color: #94a3b8;
      font-size: 10px;
    }

    .history-top {
      cursor: pointer;
    }

    .badge,
    .history-badge {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      border-radius: 999px;
      background: #ecf5ff;
      color: #409eff;
      padding: 0 7px;
      font-size: 10px;
      font-weight: 800;
    }

    .history-badge.selection {
      background: #ecf5ff;
      color: #2563eb;
    }

    .history-badge.page {
      background: #f0fdf4;
      color: #15803d;
    }

    .history-badge.self {
      border: 1px solid #faecd8;
      background: #fdf6ec;
      color: #e6a23c;
    }

    .history-badge.test {
      background: #f1f5f9;
      color: #475569;
    }

    .history-lang {
      flex: 1;
      color: #6b7280;
      font-size: 10px;
      text-align: center;
    }

    .history-time {
      color: #6b7280;
      font-size: 10px;
    }

    .source,
    .history-source {
      color: #94a3b8;
      font-size: 11px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .translation,
    .history-translation {
      margin-top: 7px;
      color: #111827;
      font-size: 12px;
      font-weight: 650;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .history-item:not([data-expanded="true"]) .history-source,
    .history-item:not([data-expanded="true"]) .history-translation {
      display: -webkit-box;
      overflow: hidden;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
    }

    .floating-word-book-list {
      display: grid;
      gap: 7px;
    }

    .floating-word-book-toolbar .history-search {
      flex: 1 1 auto;
      max-width: none;
    }

    .floating-word-book-sort-control {
      position: relative;
      flex: 0 0 auto;
    }

    .floating-word-book-sort-trigger,
    .floating-word-book-sort-menu button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #dbe3ee;
      background: #fff;
      color: #64748b;
      cursor: pointer;
      transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, color 140ms ease;
    }

    .floating-word-book-sort-trigger {
      width: 26px;
      height: 26px;
      border-radius: 8px;
    }

    .floating-word-book-sort-trigger:hover,
    .floating-word-book-sort-trigger[aria-expanded="true"] {
      border-color: #b3d8ff;
      background: #ecf5ff;
      color: #409eff;
      transform: translateY(-1px);
    }

    .floating-word-book-filter-icon,
    .floating-word-book-clock-icon {
      display: inline-block;
      width: 13px;
      height: 13px;
      background: currentColor;
      mask-position: center;
      mask-repeat: no-repeat;
      mask-size: 13px 13px;
      -webkit-mask-position: center;
      -webkit-mask-repeat: no-repeat;
      -webkit-mask-size: 13px 13px;
    }

    .floating-word-book-filter-icon {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' d='M4 6h16l-6.2 7v4.7l-3.6 1.8V13L4 6Z'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' d='M4 6h16l-6.2 7v4.7l-3.6 1.8V13L4 6Z'/%3E%3C/svg%3E");
    }

    .floating-word-book-clock-icon {
      mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='8' fill='none' stroke='black' stroke-width='2.2'/%3E%3Cpath d='M12 7v5l3.2 2' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='12' cy='12' r='8' fill='none' stroke='black' stroke-width='2.2'/%3E%3Cpath d='M12 7v5l3.2 2' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    }

    .floating-word-book-sort-menu {
      position: absolute;
      z-index: 5;
      top: calc(100% + 5px);
      right: 0;
      display: grid;
      gap: 4px;
      width: 32px;
      padding: 4px;
      border: 1px solid #dbe3ee;
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14);
    }

    .floating-word-book-sort-menu[hidden] {
      display: none;
    }

    .floating-word-book-sort-menu button {
      width: 32px;
      height: 26px;
      gap: 2px;
      border-color: transparent;
      border-radius: 6px;
      font-size: 10px;
    }

    .floating-word-book-sort-menu button:hover,
    .floating-word-book-sort-menu button.is-active {
      background: #ecf5ff;
      color: #409eff;
    }

    .floating-word-book-alpha-icon {
      font-size: 10px;
      font-weight: 700;
    }

    .floating-word-book-sort-direction {
      font-size: 10px;
      line-height: 1;
    }

    .floating-word-book-sort-trigger[data-tip]::after,
    .floating-word-book-sort-menu button[data-tip]::after {
      content: attr(data-tip);
      position: absolute;
      z-index: 7;
      top: calc(100% + 6px);
      right: 0;
      padding: 5px 7px;
      border-radius: 7px;
      background: rgba(15, 23, 42, 0.9);
      color: #fff;
      font-size: 10px;
      line-height: 1.2;
      opacity: 0;
      pointer-events: none;
      transform: translateY(-3px);
      transition: opacity 120ms ease, transform 120ms ease;
      white-space: nowrap;
    }

    .floating-word-book-sort-trigger[data-tip]:hover::after,
    .floating-word-book-sort-menu button[data-tip]:hover::after {
      opacity: 1;
      transform: translateY(0);
    }

    .floating-word-book-item {
      display: grid;
      gap: 5px;
      padding: 9px;
      border: 1px solid #eef2f7;
      border-radius: 10px;
      background: #fbfdff;
      cursor: pointer;
      transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;
    }

    .floating-word-book-item:hover {
      border-color: #dbeafe;
      background: #f8fbff;
      transform: translateY(-1px);
    }

    .floating-word-book-head {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    .floating-word-book-word {
      min-width: 0;
      color: #1f2937;
      font-size: 14px;
      font-weight: 800;
    }

    .floating-word-book-meta {
      overflow: hidden;
      color: #94a3b8;
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .floating-word-book-meaning {
      color: #475569;
      font-size: 11px;
      line-height: 1.45;
    }

    .floating-word-book-footer {
      color: #94a3b8;
      font-size: 10px;
      text-align: right;
    }

    .floating-word-book-remove {
      flex: 0 0 auto;
      min-height: 24px;
      margin-left: auto;
      padding: 0 7px;
      border: 1px solid #fecaca;
      border-radius: 8px;
      background: #fff;
      color: #dc2626;
      cursor: pointer;
      font-size: 10px;
    }

    .floating-word-book-remove:hover {
      background: #fff1f2;
      transform: translateY(-1px);
    }

    .history-more {
      color: #64748b;
      font-size: 10px;
      cursor: pointer;
    }

    .usage-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 7px;
    }

    .usage-card {
      padding: 8px;
      border: 1px solid #eef2f7;
      border-radius: 12px;
      background: #fbfdff;
    }

    .usage-label {
      color: #6b7280;
      font-size: 10px;
    }

    .usage-value {
      margin-top: 3px;
      color: #111827;
      font-size: 16px;
      font-weight: 800;
    }

    .usage-bars {
      display: grid;
      gap: 8px;
    }

    .usage-line {
      display: grid;
      gap: 5px;
      margin-top: 8px;
      color: #64748b;
      font-size: 11px;
    }

    .usage-bar-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: #64748b;
      font-size: 11px;
    }

    .usage-bar {
      height: 7px;
      border-radius: 999px;
      background: #edf2f7;
      overflow: hidden;
    }

    .usage-bar span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: #409eff;
    }

    .usage-bar-fill.page {
      background: #67c23a;
    }

    .usage-bar-fill.self {
      background: #e6a23c;
    }

    .usage-bar-fill.test {
      background: #94a3b8;
    }

    .panel-confirm-layer {
      position: absolute;
      inset: 0;
      z-index: 30;
      display: grid;
      place-items: center;
      padding: 14px;
      box-sizing: border-box;
      border-radius: inherit;
      background: rgba(30, 41, 59, 0.16);
      backdrop-filter: blur(2px);
      cursor: default;
      animation: panelConfirmFadeIn 140ms ease both;
    }

    .panel-confirm-card {
      width: min(224px, 100%);
      box-sizing: border-box;
      padding: 13px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 13px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 14px 32px rgba(15, 23, 42, 0.2);
      animation: panelConfirmCardIn 170ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }

    .panel-confirm-title {
      color: #1f2937;
      font-size: 13px;
      font-weight: 750;
    }

    .panel-confirm-message {
      margin-top: 6px;
      color: #374151;
      font-size: 11px;
      line-height: 1.5;
    }

    .panel-confirm-note {
      margin-top: 3px;
      color: #9ca3af;
      font-size: 10px;
    }

    .panel-confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 12px;
    }

    .panel-confirm-actions button {
      min-height: 27px;
      padding: 0 10px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 130ms ease, background 130ms ease, border-color 130ms ease, color 130ms ease;
    }

    .panel-confirm-cancel {
      border: 1px solid #d8dee8;
      background: #ffffff;
      color: #64748b;
    }

    .panel-confirm-cancel:hover,
    .panel-confirm-cancel:focus-visible {
      border-color: #b3d8ff;
      background: #f4f9ff;
      color: #2563eb;
      outline: none;
    }

    .panel-confirm-danger {
      border: 1px solid #fca5a5;
      background: #fff5f5;
      color: #dc2626;
    }

    .panel-confirm-danger:hover,
    .panel-confirm-danger:focus-visible {
      border-color: #ef4444;
      background: #feecec;
      color: #b91c1c;
      outline: none;
    }

    .panel-confirm-actions button:active {
      transform: scale(0.97);
    }

    @keyframes panelConfirmFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes panelConfirmCardIn {
      from { opacity: 0; transform: translateY(4px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes floatingSwapFlip {
      0% { transform: rotate(0deg) scale(1); }
      58% { transform: rotate(198deg) scale(1.12); }
      100% { transform: rotate(180deg) scale(1); }
    }

    @keyframes floatingSelectionStarHop {
      0% { transform: translateY(0) scale(1) rotate(0); }
      38% { transform: translateY(-7px) scale(1.16) rotate(12deg); }
      64% { transform: translateY(1px) scale(0.96) rotate(-2deg); }
      82% { transform: translateY(-1px) scale(1.03) rotate(1deg); }
      100% { transform: translateY(0) scale(1) rotate(0); }
    }

    @keyframes floatingSelectionStarSparkle {
      0%, 44% { transform: scale(0.86) rotate(0); opacity: 0.74; }
      52% { transform: scale(1.16) rotate(13deg); opacity: 1; }
      62%, 100% { transform: scale(1) rotate(0); opacity: 0.84; }
    }

    @keyframes floatingSelectionSmoke {
      0% { opacity: 0; transform: scale(0.3) rotate(-8deg); filter: blur(1px); }
      25% { opacity: 0.92; }
      66% { opacity: 0.84; transform: scale(1.08) rotate(4deg); filter: blur(0); }
      100% { opacity: 0; transform: scale(1.34) translateY(-3px); filter: blur(1px); }
    }

    @keyframes floatingSelectionMagnifierIn {
      0%, 33% { opacity: 0; transform: translate(1px, 2px) rotate(-13deg) scale(0.3); }
      58% { opacity: 1; transform: translate(-1px, -1px) rotate(5deg) scale(1.08); }
      78% { transform: translate(0, 0) rotate(-2deg) scale(0.96); }
      100% { opacity: 1; transform: translate(0, 0) rotate(0) scale(1); }
    }

    @keyframes floatingSelectionMagnifierOut {
      0% { opacity: 1; transform: translate(0, 0) rotate(0) scale(1); }
      32% { opacity: 1; transform: translate(-1px, -1px) rotate(5deg) scale(1.06); }
      72%, 100% { opacity: 0; transform: translate(1px, 2px) rotate(-13deg) scale(0.28); }
    }

    @keyframes floatingPanelIn {
      from {
        opacity: 0;
        transform: translateY(6px) scale(0.985);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
  `;

  shadow.append(style, wrapper);

  const isolateAssistantInputEvent = (event) => {
    event.stopPropagation();
  };
  ["keypress", "keyup", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend", "paste", "cut", "copy", "focusin", "focusout"]
    .forEach((type) => wrapper.addEventListener(type, isolateAssistantInputEvent));
  wrapper.addEventListener("keydown", (event) => {
    event.stopPropagation();
    const control = event.composedPath().find((node) => node?.matches?.("input, textarea, select, [contenteditable='true']"));
    const isEditingKey = event.key.length === 1 || event.key === "Backspace" || event.key === "Delete";
    if (!control || !isEditingKey) return;
    queueMicrotask(() => {
      if (control.isConnected && shadow.activeElement !== control) {
        control.focus({ preventScroll: true });
      }
    });
  });

  const button = shadow.querySelector(".floating-button");
  setFloatingAssistantTranslationBusy("launcher-init", false);
  const cluster = shadow.querySelector(".floating-cluster");
  const selectionToggle = shadow.querySelector(".floating-selection-toggle");
  const dismissTrigger = shadow.querySelector(".floating-dismiss-trigger");
  const dismissMenu = shadow.querySelector(".dismiss-menu");
  const menu = shadow.querySelector(".floating-menu");
  const pageButton = shadow.querySelector('[data-action="page"]');
  const pageDisplayDot = shadow.querySelector(".page-display-dot");
  const pageRetryButton = shadow.querySelector(".page-translation-retry");
  const pageCancelButton = shadow.querySelector(".page-translation-cancel");
  const pageProgressPopover = shadow.querySelector(".page-translation-progress-popover");
  const pageDisplayMenu = shadow.querySelector(".floating-page-display-menu");
  const floatingActionTooltip = shadow.querySelector(".floating-action-tooltip");
  const moreToggle = shadow.querySelector(".tool-button-more");
  const overflowButtons = [...shadow.querySelectorAll(".tool-button-overflow")];
  const compactActionButtons = [...shadow.querySelectorAll(".floating-menu [data-action]:not(.tool-button-overflow)")];
  const panel = shadow.querySelector(".floating-panel");
  const panelHead = shadow.querySelector(".panel-head");
  const title = shadow.querySelector(".panel-head h2");
  const panelControls = shadow.querySelector(".panel-controls");
  const panelPinToggle = shadow.querySelector(".panel-pin-toggle");
  const panelOpacityToggle = shadow.querySelector(".panel-opacity-toggle");
  const panelOpacityControl = shadow.querySelector(".panel-opacity-control");
  const panelOpacitySlider = shadow.querySelector(".panel-opacity-slider");
  const panelOpacityRange = shadow.querySelector(".panel-opacity-range");
  const panelOpacityTicks = shadow.querySelector(".panel-opacity-ticks");
  const close = shadow.querySelector(".panel-close");
  const status = shadow.querySelector(".panel-status");
  const body = shadow.querySelector(".panel-body");
  const state = {
    x: window.innerWidth - 54,
    y: Math.round(window.innerHeight * 0.45),
    startX: 0,
    startY: 0,
    pointerX: 0,
    pointerY: 0,
    moved: false,
    dragging: false,
    translated: false,
    panelAnchorX: null,
    panelAnchorY: null,
    panelOffsetX: 0,
    panelOffsetY: 0,
    panelManualOffsetX: null,
    panelManualOffsetY: null,
    panelDragging: false,
    panelStartX: 0,
    panelStartY: 0,
    panelPointerX: 0,
    panelPointerY: 0,
    panelOpacity: 100,
    panelOpacityDragging: false,
    panelOpacityMoved: false,
    panelOpacityPointerX: 0,
    suppressOpacityControlClick: false,
    panelPinned: false,
    activeAction: "",
    pageDisplayMenuOpen: false,
    moreMenuOpen: false,
    moreMenuTimer: 0,
    moreMenuFrame: 0,
    menuLiquidMapFrame: 0,
    compactMenuHeight: 0,
    suppressMoreHover: false,
    moreHoverResetTimer: 0,
    selectionToggleTimer: 0
  };

  const hideFloatingActionTooltip = () => {
    floatingActionTooltip.classList.remove("is-visible");
    floatingActionTooltip.hidden = true;
  };
  const showFloatingActionTooltip = (target) => {
    const text = target?.dataset.floatingTip;
    if (!text || target.hidden) {
      hideFloatingActionTooltip();
      return;
    }
    floatingActionTooltip.textContent = text;
    floatingActionTooltip.hidden = false;
    floatingActionTooltip.classList.remove("is-visible");
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = floatingActionTooltip.getBoundingClientRect();
    const placeOnLeft = targetRect.left + targetRect.width / 2 > window.innerWidth / 2;
    let left = placeOnLeft
      ? targetRect.left - tooltipRect.width - 7
      : targetRect.right + 7;
    let top = targetRect.top + (targetRect.height - tooltipRect.height) / 2;
    const progressPopover = target === pageButton && !pageProgressPopover.hidden
      ? pageProgressPopover.getBoundingClientRect()
      : null;
    if (progressPopover?.width) {
      const above = progressPopover.top - tooltipRect.height - 5;
      const below = progressPopover.bottom + 5;
      top = above >= 6 ? above : below;
      left = Math.min(
        Math.max(6, progressPopover.left + (progressPopover.width - tooltipRect.width) / 2),
        Math.max(6, window.innerWidth - tooltipRect.width - 6)
      );
    }
    left = Math.min(Math.max(6, left), Math.max(6, window.innerWidth - tooltipRect.width - 6));
    top = Math.min(Math.max(6, top), Math.max(6, window.innerHeight - tooltipRect.height - 6));
    floatingActionTooltip.style.left = `${left}px`;
    floatingActionTooltip.style.top = `${top}px`;
    requestAnimationFrame(() => floatingActionTooltip.classList.add("is-visible"));
  };
  [pageButton, pageDisplayDot, pageRetryButton, pageCancelButton].forEach((target) => {
    target.addEventListener("pointerenter", () => showFloatingActionTooltip(target));
    target.addEventListener("pointerleave", hideFloatingActionTooltip);
    target.addEventListener("focus", () => showFloatingActionTooltip(target));
    target.addEventListener("blur", hideFloatingActionTooltip);
  });

  const smoothFloatingGlassStep = (start, end, value) => {
    const progress = Math.min(Math.max((value - start) / (end - start), 0), 1);
    return progress * progress * (3 - 2 * progress);
  };
  const floatingRoundedRectSdf = (x, y, width, height, radius) => {
    const offsetX = Math.abs(x) - width + radius;
    const offsetY = Math.abs(y) - height + radius;
    return (
      Math.min(Math.max(offsetX, offsetY), 0) +
      Math.hypot(Math.max(offsetX, 0), Math.max(offsetY, 0)) -
      radius
    );
  };
  let floatingGlassMapKey = "";
  let floatingGlassSyncUntil = 0;
  const buildFloatingMenuLiquidGlass = (width, height) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = width;
    canvas.height = height;

    const rawValues = [];
    const imageData = new Uint8ClampedArray(width * height * 4);
    let maximumScale = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const centeredX = x / width - 0.5;
        const centeredY = y / height - 0.5;
        const distanceToEdge = floatingRoundedRectSdf(
          centeredX,
          centeredY,
          0.3,
          0.2,
          0.6
        );
        const displacement = smoothFloatingGlassStep(
          0.8,
          0,
          distanceToEdge - 0.15
        );
        const scaled = smoothFloatingGlassStep(0, 1, displacement);
        const displacementX = (centeredX * scaled + 0.5) * width - x;
        const displacementY = (centeredY * scaled + 0.5) * height - y;
        maximumScale = Math.max(
          maximumScale,
          Math.abs(displacementX),
          Math.abs(displacementY)
        );
        rawValues.push(displacementX, displacementY);
      }
    }

    maximumScale = Math.max(maximumScale * 0.5, 0.001);
    let rawIndex = 0;
    for (let index = 0; index < imageData.length; index += 4) {
      imageData[index] = (rawValues[rawIndex] / maximumScale + 0.5) * 255;
      imageData[index + 1] =
        (rawValues[rawIndex + 1] / maximumScale + 0.5) * 255;
      imageData[index + 2] = 0;
      imageData[index + 3] = 255;
      rawIndex += 2;
    }

    context.putImageData(new ImageData(imageData, width, height), 0, 0);
    const mapUrl = canvas.toDataURL();
    liquidImage.setAttributeNS("http://www.w3.org/1999/xlink", "href", mapUrl);
    liquidImage.setAttribute("width", String(width));
    liquidImage.setAttribute("height", String(height));
    liquidDisplacement.setAttribute("scale", String(maximumScale));
    liquidFilter.setAttribute("x", "0");
    liquidFilter.setAttribute("y", "0");
    liquidFilter.setAttribute("width", String(width));
    liquidFilter.setAttribute("height", String(height));
  };
  const syncFloatingMenuLiquidGlass = () => {
    if (!floatingGlass.isConnected || !menu.isConnected) return;
    const menuStyle = getComputedStyle(menu);
    const menuOpacity = Number.parseFloat(menuStyle.opacity) || 0;
    const rect = menu.getBoundingClientRect();
    if (menuOpacity <= 0.002 || rect.width < 1 || rect.height < 1) {
      floatingGlass.style.opacity = "0";
      floatingGlass.style.visibility = "hidden";
      return;
    }

    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const scale = menu.offsetWidth ? rect.width / menu.offsetWidth : 1;
    floatingGlass.style.left = `${rect.left}px`;
    floatingGlass.style.top = `${rect.top}px`;
    floatingGlass.style.width = `${rect.width}px`;
    floatingGlass.style.height = `${rect.height}px`;
    floatingGlass.style.borderRadius = `${9 * scale}px`;
    floatingGlass.style.opacity = String(menuOpacity);
    floatingGlass.style.visibility = "visible";

    const mapKey = `${width}x${height}`;
    if (mapKey !== floatingGlassMapKey) {
      floatingGlassMapKey = mapKey;
      buildFloatingMenuLiquidGlass(width, height);
    }
  };
  const scheduleFloatingMenuLiquidGlass = (duration = 520) => {
    floatingGlassSyncUntil = Math.max(
      floatingGlassSyncUntil,
      performance.now() + duration
    );
    if (state.menuLiquidMapFrame) {
      return;
    }
    const update = (time) => {
      syncFloatingMenuLiquidGlass();
      if (time < floatingGlassSyncUntil) {
        state.menuLiquidMapFrame = window.requestAnimationFrame(update);
      } else {
        state.menuLiquidMapFrame = 0;
      }
    };
    state.menuLiquidMapFrame = window.requestAnimationFrame(update);
  };
  menu.addEventListener("transitionrun", () => scheduleFloatingMenuLiquidGlass());
  menu.addEventListener("transitionend", () => scheduleFloatingMenuLiquidGlass(80));
  cluster.addEventListener("pointerenter", () => scheduleFloatingMenuLiquidGlass(700));
  cluster.addEventListener("pointerleave", () => scheduleFloatingMenuLiquidGlass(420));
  wrapper.addEventListener("focusin", () => scheduleFloatingMenuLiquidGlass(700));
  wrapper.addEventListener("focusout", () => scheduleFloatingMenuLiquidGlass(420));

  const releaseMoreHoverSuppression = () => {
    if (state.moreHoverResetTimer) window.clearTimeout(state.moreHoverResetTimer);
    state.moreHoverResetTimer = 0;
    state.suppressMoreHover = false;
  };
  const renderMoreMenu = (expanded) => {
    moreToggle.hidden = expanded;
    moreToggle.setAttribute("aria-expanded", String(expanded));
    overflowButtons.forEach((overflowButton) => {
      overflowButton.hidden = !expanded;
    });
  };
  const clearMoreMenuAnimation = () => {
    if (state.moreMenuTimer) window.clearTimeout(state.moreMenuTimer);
    if (state.moreMenuFrame) window.cancelAnimationFrame(state.moreMenuFrame);
    state.moreMenuTimer = 0;
    state.moreMenuFrame = 0;
    menu.classList.remove("is-more-animating", "is-more-expanding", "is-more-collapsing");
  };
  const finishMoreMenuAnimation = () => {
    clearMoreMenuAnimation();
    if (!state.moreMenuOpen) {
      renderMoreMenu(false);
      if (state.suppressMoreHover) {
        state.moreHoverResetTimer = window.setTimeout(releaseMoreHoverSuppression, 80);
      }
    }
    menu.style.height = "";
    scheduleFloatingMenuLiquidGlass();
  };
  const updateMoreMenu = (open) => {
    const expanded = Boolean(open);
    const animating = menu.classList.contains("is-more-animating");
    if (expanded === state.moreMenuOpen && !animating) return;

    const startHeight = menu.getBoundingClientRect().height;
    clearMoreMenuAnimation();
    menu.style.height = `${startHeight}px`;

    if (expanded) {
      if (!state.moreMenuOpen && !state.compactMenuHeight) {
        state.compactMenuHeight = startHeight;
      }
      state.moreMenuOpen = true;
      renderMoreMenu(true);
      menu.style.height = "auto";
      const expandedHeight = menu.getBoundingClientRect().height;
      menu.style.height = `${startHeight}px`;
      scheduleFloatingMenuLiquidGlass(620);
      menu.classList.add("is-more-animating", "is-more-expanding");
      void menu.offsetHeight;
      state.moreMenuFrame = window.requestAnimationFrame(() => {
        menu.style.height = `${expandedHeight}px`;
      });
      state.moreMenuTimer = window.setTimeout(finishMoreMenuAnimation, 480);
      return;
    }

    state.moreMenuOpen = false;
    moreToggle.setAttribute("aria-expanded", "false");
    menu.classList.add("is-more-animating", "is-more-collapsing");
    void menu.offsetHeight;
    state.moreMenuFrame = window.requestAnimationFrame(() => {
      menu.style.height = `${state.compactMenuHeight || startHeight}px`;
    });
    state.moreMenuTimer = window.setTimeout(finishMoreMenuAnimation, 310);
  };
  const supportsOpacityControls = (action) => action === "self" || action === "history" || action === "wordbook";
  const applyPanelAppearance = (preferences = {}) => {
    state.panelOpacity = Math.min(PANEL_OPACITY_MAX, Math.max(PANEL_OPACITY_MIN, Number(preferences.opacity) || PANEL_OPACITY_MAX));
    const ratio = state.panelOpacity / PANEL_OPACITY_MAX;
    const sliderPosition = ((state.panelOpacity - PANEL_OPACITY_MIN) / (PANEL_OPACITY_MAX - PANEL_OPACITY_MIN)) * 100;
    panel.style.setProperty("--panel-content-opacity", String(ratio));
    panel.style.setProperty("--panel-background-opacity", String(0.38 + ratio * 0.52));
    panelOpacitySlider.style.setProperty("--opacity-position", `${sliderPosition}%`);
    panelOpacityRange.value = String(state.panelOpacity);
  };
  const savePanelPreferences = async () => {
    if (!supportsOpacityControls(state.activeAction)) return;
    const stored = await chrome.storage.local.get({ [FLOATING_PANEL_PREFERENCES_KEY]: {} });
    const preferences = stored[FLOATING_PANEL_PREFERENCES_KEY] || {};
    preferences[state.activeAction] = { opacity: state.panelOpacity };
    await chrome.storage.local.set({ [FLOATING_PANEL_PREFERENCES_KEY]: preferences });
  };
  const closePanelOpacityControl = () => {
    panelOpacityControl.hidden = true;
    panelOpacityToggle.setAttribute("aria-expanded", "false");
  };
  const updatePanelPinState = () => {
    panelPinToggle.classList.toggle("is-active", state.panelPinned);
    panelPinToggle.setAttribute("aria-pressed", String(state.panelPinned));
    panelPinToggle.title = state.panelPinned ? "取消置顶" : "临时置顶";
    panelPinToggle.setAttribute("aria-label", state.panelPinned ? "取消置顶" : "临时置顶");
    panelPinToggle.dataset.tip = panelPinToggle.title;
  };
  const resetPanelPin = () => {
    state.panelPinned = false;
    updatePanelPinState();
  };
  const closeFloatingPanel = ({ keepMenuExpanded = false } = {}) => {
    panel.hidden = true;
    state.activeAction = "";
    if (keepMenuExpanded) {
      menu.classList.toggle("is-pinned", !menu.matches(":hover"));
    } else {
      menu.classList.remove("is-pinned");
      updateMoreMenu(false);
    }
    closePanelOpacityControl();
    resetPanelPin();
  };
  const configurePanelControls = async (action) => {
    const opacityEnabled = supportsOpacityControls(action);
    panelControls.hidden = false;
    panelOpacityToggle.hidden = !opacityEnabled;
    closePanelOpacityControl();
    updatePanelPinState();
    applyPanelAppearance();
    if (!opacityEnabled) return;
    const stored = await chrome.storage.local.get({ [FLOATING_PANEL_PREFERENCES_KEY]: {} });
    if (state.activeAction !== action || panel.hidden) return;
    applyPanelAppearance(stored[FLOATING_PANEL_PREFERENCES_KEY]?.[action]);
  };

  loadFloatingPosition().then((position) => {
    if (position) {
      state.x = position.x;
      state.y = position.y;
    }
    applyFloatingPosition(wrapper, panel, state);
    updateFloatingPageButton(menu, state);
  });
  updateFloatingSelectionMode();
  updateFloatingPageProgressUi();

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideFloatingActionTooltip();
    state.dragging = true;
    state.moved = false;
    state.startX = state.x;
    state.startY = state.y;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    button.classList.add("is-dragging");
    button.setPointerCapture(event.pointerId);
  });

  selectionToggle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  selectionToggle.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nextEnabled = !selectionTranslationEnabled;
    const cluster = shadow.querySelector(".floating-cluster");
    window.clearTimeout(state.selectionToggleTimer);
    cluster.classList.remove("is-selection-toggling");
    void cluster.offsetWidth;
    applySelectionTranslationPreference(nextEnabled);
    cluster.classList.add("is-selection-toggling");
    state.selectionToggleTimer = window.setTimeout(() => {
      cluster.classList.remove("is-selection-toggling");
      state.selectionToggleTimer = 0;
    }, 820);
    try {
      await chrome.storage.local.set({ [SELECTION_TRANSLATION_ENABLED_KEY]: nextEnabled });
    } catch {
      applySelectionTranslationPreference(!nextEnabled);
      cluster.classList.remove("is-selection-toggling");
    }
  });

  dismissTrigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dismissMenu.hidden = !dismissMenu.hidden;
    dismissTrigger.classList.toggle("is-open", !dismissMenu.hidden);
  });

  document.addEventListener("pointerdown", (event) => {
    const path = event.composedPath();
    const insideDismiss = path.includes(dismissMenu) || path.includes(dismissTrigger);
    const insidePanel = path.includes(panel);
    const insideLauncher = path.includes(button) || path.includes(selectionToggle) || path.includes(menu);
    if (!insideDismiss) {
      dismissMenu.hidden = true;
      dismissTrigger.classList.remove("is-open");
    }
    if (state.pageDisplayMenuOpen && !path.includes(pageDisplayDot) && !path.includes(pageDisplayMenu)) {
      state.pageDisplayMenuOpen = false;
      updateFloatingPageButton(menu, state);
    }
    if (!path.includes(menu) && !insidePanel) {
      if (panel.hidden) menu.classList.remove("is-pinned");
      updateMoreMenu(false);
    }
    if (!panelOpacityControl.hidden && !path.includes(panelOpacityControl) && !path.includes(panelOpacityToggle)) {
      closePanelOpacityControl();
    }
    if (!panel.hidden && !state.panelPinned && !insidePanel && !insideLauncher && !insideDismiss) {
      closeFloatingPanel();
    }
  });

  dismissMenu.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-dismiss]")?.dataset.dismiss;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "pause") {
      await pauseAssistantMode();
    } else {
      await disableAssistantMode();
    }
  });

  button.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    event.preventDefault();
    const dx = event.clientX - state.pointerX;
    const dy = event.clientY - state.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.moved = true;
    state.x = state.startX + dx;
    state.y = state.startY + dy;
    applyFloatingPosition(wrapper, panel, state);
    scheduleFloatingMenuLiquidGlass(140);
  });

  button.addEventListener("pointerup", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!state.dragging) return;
    state.dragging = false;
    button.classList.remove("is-dragging");
    clampFloatingState(state);
    applyFloatingPosition(wrapper, panel, state);
    scheduleFloatingMenuLiquidGlass(220);
    saveFloatingPosition(state);
  });

  button.addEventListener("lostpointercapture", () => {
    state.dragging = false;
    button.classList.remove("is-dragging");
  });

  panelHead.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".panel-close, .panel-controls") || panel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = panel.getBoundingClientRect();
    state.panelDragging = true;
    state.panelStartX = rect.left;
    state.panelStartY = rect.top;
    state.panelPointerX = event.clientX;
    state.panelPointerY = event.clientY;
    panelHead.classList.add("is-dragging");
    panelHead.setPointerCapture(event.pointerId);
  });

  panelHead.addEventListener("pointermove", (event) => {
    if (!state.panelDragging) return;
    event.preventDefault();
    const panelWidth = panel.offsetWidth || 320;
    const panelHeight = panel.offsetHeight || 160;
    const nextX = state.panelStartX + event.clientX - state.panelPointerX;
    const nextY = state.panelStartY + event.clientY - state.panelPointerY;
    const left = Math.min(Math.max(12, nextX), Math.max(12, window.innerWidth - panelWidth - 12));
    const top = Math.min(Math.max(12, nextY), Math.max(12, window.innerHeight - panelHeight - 12));
    state.panelManualOffsetX = left - state.x;
    state.panelManualOffsetY = top - state.y;
    applyFloatingPosition(wrapper, panel, state);
  });

  const finishPanelDrag = () => {
    state.panelDragging = false;
    panelHead.classList.remove("is-dragging");
  };
  panelHead.addEventListener("pointerup", finishPanelDrag);
  panelHead.addEventListener("lostpointercapture", finishPanelDrag);

  window.addEventListener("resize", () => {
    hideFloatingActionTooltip();
    clampFloatingState(state);
    applyFloatingPosition(wrapper, panel, state);
    scheduleFloatingMenuLiquidGlass(320);
    saveFloatingPosition(state);
  });

  close.addEventListener("click", () => closeFloatingPanel({ keepMenuExpanded: true }));

  panelPinToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    state.panelPinned = !state.panelPinned;
    updatePanelPinState();
  });

  panelOpacityToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    panelOpacityControl.hidden = !panelOpacityControl.hidden;
    panelOpacityToggle.setAttribute("aria-expanded", String(!panelOpacityControl.hidden));
  });

  panelOpacityControl.addEventListener("click", (event) => {
    if (state.suppressOpacityControlClick) {
      event.stopPropagation();
      return;
    }
    closePanelOpacityControl();
  });

  const updateOpacityFromPointer = (event) => {
    const rect = panelOpacitySlider.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    applyPanelAppearance({ opacity: Math.round(PANEL_OPACITY_MIN + ratio * (PANEL_OPACITY_MAX - PANEL_OPACITY_MIN)) });
  };

  panelOpacitySlider.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-opacity]")) return;
    event.preventDefault();
    state.panelOpacityDragging = true;
    state.panelOpacityMoved = false;
    state.panelOpacityPointerX = event.clientX;
    updateOpacityFromPointer(event);
    panelOpacitySlider.setPointerCapture(event.pointerId);
  });

  panelOpacitySlider.addEventListener("pointermove", (event) => {
    if (!state.panelOpacityDragging) return;
    event.preventDefault();
    if (Math.abs(event.clientX - state.panelOpacityPointerX) > 2) {
      state.panelOpacityMoved = true;
    }
    updateOpacityFromPointer(event);
  });

  const finishOpacityDrag = () => {
    if (!state.panelOpacityDragging) return;
    state.panelOpacityDragging = false;
    if (state.panelOpacityMoved) {
      state.suppressOpacityControlClick = true;
      window.setTimeout(() => {
        state.suppressOpacityControlClick = false;
      }, 0);
    }
    savePanelPreferences();
  };
  panelOpacitySlider.addEventListener("pointerup", finishOpacityDrag);
  panelOpacitySlider.addEventListener("lostpointercapture", finishOpacityDrag);

  panelOpacityRange.addEventListener("input", () => {
    applyPanelAppearance({ opacity: panelOpacityRange.value });
    savePanelPreferences();
  });

  panelOpacityTicks.addEventListener("click", (event) => {
    const point = event.target.closest("[data-opacity]");
    if (!point) return;
    applyPanelAppearance({ opacity: point.dataset.opacity });
    savePanelPreferences();
  });

  moreToggle.addEventListener("pointerenter", () => {
    if (state.suppressMoreHover) {
      releaseMoreHoverSuppression();
      return;
    }
    updateMoreMenu(true);
  });
  moreToggle.addEventListener("pointerleave", releaseMoreHoverSuppression);
  moreToggle.addEventListener("focus", () => updateMoreMenu(true));

  menu.addEventListener("mouseenter", () => {
    if (panel.hidden) menu.classList.remove("is-pinned");
  });

  compactActionButtons.forEach((actionButton) => {
    actionButton.addEventListener("pointerenter", () => {
      if (state.moreMenuOpen && !menu.classList.contains("is-pinned")) {
        if (state.moreHoverResetTimer) window.clearTimeout(state.moreHoverResetTimer);
        state.moreHoverResetTimer = 0;
        state.suppressMoreHover = true;
        updateMoreMenu(false);
      }
    });
  });

  menu.addEventListener("mouseleave", () => {
    releaseMoreHoverSuppression();
    if (!menu.classList.contains("is-pinned")) updateMoreMenu(false);
  });

  pageRetryButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideFloatingActionTooltip();
    if (!pageTranslationProgress.active && translatedNodes.length) {
      pageRetryButton.classList.remove("is-retrying");
      void pageRetryButton.offsetWidth;
      pageRetryButton.classList.add("is-retrying");
      setFloatingStatus(status, "正在重新翻译整页");
      try {
        restorePageText();
        state.translated = false;
        const count = await translateVisiblePage({ waitForRunning: true, forceRefresh: true });
        state.translated = translatedNodes.length > 0;
        setFloatingStatus(status, state.translated ? `已重新翻译 ${count || translatedNodes.length} 段` : "暂时没有找到可翻译正文");
      } catch (error) {
        setFloatingStatus(status, error.message || String(error), true);
      } finally {
        updateFloatingPageButton(menu, state);
      }
      return;
    }
    const failedCount = pageTranslationFailedEntries.size;
    if (!failedCount) {
      setFloatingStatus(status, "目前没有失败内容");
      return;
    }
    pageRetryButton.classList.remove("is-retrying");
    void pageRetryButton.offsetWidth;
    pageRetryButton.classList.add("is-retrying");
    const retryQueued = pageTranslationRunning;
    setFloatingStatus(status, retryQueued ? "已安排重试失败内容" : "正在重试失败内容");
    try {
      const count = await retryFailedPageTranslation();
      if (!retryQueued) {
        setFloatingStatus(status, count > 0 ? `已重新翻译 ${count} 段` : "暂时没有可重试内容");
      }
    } catch (error) {
      setFloatingStatus(status, error.message || String(error), true);
    }
  });

  pageCancelButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideFloatingActionTooltip();
    cancelPageTranslation();
    state.translated = translatedNodes.length > 0;
    setFloatingStatus(status, state.translated ? "已取消，保留当前译文" : "已取消整页翻译");
    updateFloatingPageButton(menu, state);
  });

  pageDisplayMenu.addEventListener("pointerleave", () => {
    if (!state.pageDisplayMenuOpen) return;
    state.pageDisplayMenuOpen = false;
    updateFloatingPageButton(menu, state);
  });

  menu.addEventListener("click", async (event) => {
    const displayOption = event.target.closest("[data-page-display]");
    if (displayOption) {
      const bilingual = displayOption.dataset.pageDisplay === "bilingual";
      setPageBilingualDisplay(bilingual);
      setFloatingStatus(status, bilingual ? "已切换为双语显示" : "已切换为仅译文");
      updateFloatingPageButton(menu, state);
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    dismissMenu.hidden = true;
    dismissTrigger.classList.remove("is-open");
    const action = actionButton.dataset.action;
    const actionRect = actionButton.getBoundingClientRect();
    if (action === "display") {
      state.pageDisplayMenuOpen = !state.pageDisplayMenuOpen;
      updateFloatingPageButton(menu, state);
      return;
    }
    if (action === "page") {
      await runFloatingPageAction(actionButton, menu, state, status);
      return;
    }
    if (!panel.hidden && state.activeAction === action) {
      closeFloatingPanel({ keepMenuExpanded: true });
      return;
    }
    resetPanelPin();
    state.activeAction = action;
    state.panelManualOffsetX = null;
    state.panelManualOffsetY = null;
    setFloatingPanelAnchor(state, actionRect);
    panel.hidden = false;
    menu.classList.add("is-pinned");
    configurePanelControls(action);
    renderFloatingPanel(action, { title, status, body, panel });
    applyFloatingPosition(wrapper, panel, state);
  });
}

async function loadFloatingPosition() {
  try {
    const stored = await chrome.storage.local.get({ [FLOATING_POSITION_KEY]: null });
    return normalizeFloatingPosition(stored[FLOATING_POSITION_KEY]);
  } catch {
    return null;
  }
}

async function saveFloatingPosition(state) {
  try {
    await chrome.storage.local.set({
      [FLOATING_POSITION_KEY]: {
        x: Math.round(state.x),
        y: Math.round(state.y)
      }
    });
  } catch {
    // Position persistence is helpful, but the launcher still works without it.
  }
}

function normalizeFloatingPosition(position) {
  if (!position || typeof position !== "object") return null;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function applyFloatingPosition(wrapper, panel, state) {
  clampFloatingState(state);
  wrapper.style.setProperty("--floating-x", `${state.x}px`);
  wrapper.style.setProperty("--floating-y", `${state.y}px`);
  wrapper.classList.toggle("is-left-side", state.x < 120);
  wrapper.classList.toggle("is-near-top", state.y < 210);

  const panelWidth = 320;
  const panelHeight = Math.min(520, window.innerHeight - 28);
  const anchorX = Number.isFinite(state.panelAnchorX) ? state.x + state.panelOffsetX : state.x + 18;
  const anchorY = Number.isFinite(state.panelAnchorY) ? state.y + state.panelOffsetY : state.y + 18;
  const defaultPanelLeft = anchorX > window.innerWidth / 2
    ? anchorX - panelWidth - 26
    : anchorX + 26;
  const defaultPanelTop = Math.min(
    Math.max(12, anchorY - 28),
    Math.max(12, window.innerHeight - panelHeight - 12)
  );
  const panelLeft = Number.isFinite(state.panelManualOffsetX)
    ? state.x + state.panelManualOffsetX
    : defaultPanelLeft;
  const panelTop = Number.isFinite(state.panelManualOffsetY)
    ? state.y + state.panelManualOffsetY
    : defaultPanelTop;

  panel.style.setProperty("--panel-x", `${Math.min(Math.max(12, panelLeft), Math.max(12, window.innerWidth - panelWidth - 12))}px`);
  panel.style.setProperty("--panel-y", `${panelTop}px`);
}

function setFloatingPanelAnchor(state, rect) {
  const anchorX = rect.left + rect.width / 2;
  const anchorY = rect.top + rect.height / 2;
  state.panelAnchorX = anchorX;
  state.panelAnchorY = anchorY;
  state.panelOffsetX = anchorX - state.x;
  state.panelOffsetY = anchorY - state.y;
}

function clampFloatingState(state) {
  const margin = 8;
  const size = 36;
  state.x = Math.min(Math.max(margin, state.x), Math.max(margin, window.innerWidth - size - margin));
  state.y = Math.min(Math.max(margin, state.y), Math.max(margin, window.innerHeight - size - margin));
}

function toggleFloatingPanel(panel) {
  panel.hidden = !panel.hidden;
}

async function runFloatingPageAction(button, menu, state, status) {
  if (pageTranslationProgress.active) {
    if (pageTranslationRunning) {
      const paused = togglePageTranslationPaused();
      setFloatingStatus(status, paused ? "整页翻译已暂停" : "继续整页翻译");
    } else {
      setFloatingStatus(status, "请重试失败内容，或取消本次翻译");
    }
    updateFloatingPageProgressUi();
    return;
  }

  try {
    if (state.translated || translatedNodes.length > 0) {
      setFloatingStatus(status, "正在恢复");
      restorePageText();
      state.translated = false;
      setFloatingStatus(status, "已恢复原文");
    } else {
      setFloatingStatus(status, "整页翻译中");
      const count = await translateVisiblePage({ waitForRunning: true });
      const total = translatedNodes.length;
      state.translated = total > 0;
      setFloatingStatus(status, total > 0 ? `已翻译 ${count || total} 段` : "暂时没有找到新的可翻译正文");
    }
    updateFloatingPageButton(menu, state);
  } catch (error) {
    setFloatingStatus(status, error.message || String(error), true);
  } finally {
    updateFloatingPageButton(menu, state);
  }
}

function updateFloatingPageButton(menu, state) {
  if (!menu) return;
  const button = menu.querySelector('[data-action="page"]');
  const displayDot = menu.querySelector('[data-action="display"]');
  const displayMenu = menu.querySelector(".floating-page-display-menu");
  if (!button) return;
  const translated = state.translated || translatedNodes.length > 0;
  if (displayDot && displayMenu) {
    const bilingual = pageTranslationDisplayMode === "bilingual";
    menu.classList.toggle("is-display-pinned", Boolean(state.pageDisplayMenuOpen));
    displayDot.classList.toggle("is-bilingual", bilingual);
    displayDot.dataset.tip = "显示格式";
    displayDot.dataset.floatingTip = "显示格式";
    displayDot.removeAttribute("title");
    displayDot.setAttribute("aria-label", displayDot.dataset.tip);
    displayDot.setAttribute("aria-expanded", String(Boolean(state.pageDisplayMenuOpen)));
    displayMenu.hidden = !state.pageDisplayMenuOpen;
    displayMenu.querySelectorAll("[data-page-display]").forEach((option) => {
      option.classList.toggle("is-selected", (option.dataset.pageDisplay === "bilingual") === bilingual);
    });
  }
  if (pageTranslationProgress.active) {
    updateFloatingPageProgressUi();
    return;
  }
  button.classList.remove("is-busy", "is-page-progress", "is-paused");
  button.removeAttribute("data-floating-tip");
  button.style.removeProperty("--page-progress");
  button.innerHTML = `<span class="ui-icon ${translated ? "icon-restore" : "icon-page"}" aria-hidden="true"></span>`;
  button.dataset.tip = translated ? "恢复原文" : "整页翻译";
  button.setAttribute("aria-label", button.dataset.tip);
}

function renderFloatingPanel(action, refs) {
  refs.status.textContent = "";
  refs.status.dataset.state = "";

  if (action === "settings") {
    renderFloatingSettings(refs);
  } else if (action === "self") {
    renderFloatingSelfTranslate(refs);
  } else if (action === "history") {
    renderFloatingHistory(refs);
  } else if (action === "wordbook") {
    renderFloatingWordBook(refs);
  } else if (action === "usage") {
    renderFloatingUsage(refs);
  }
}

async function renderFloatingWordBook({ title, status, body }) {
  title.textContent = "单词本";
  body.innerHTML = '<div class="toolbar floating-word-book-toolbar"><input id="floatingWordBookSearch" class="history-search" type="search" placeholder="搜索单词" autocomplete="off" /><div id="floatingWordBookSortControl" class="floating-word-book-sort-control"><button id="floatingWordBookSortTrigger" class="floating-word-book-sort-trigger" type="button" data-tip="排序：收藏时间（新到旧）" title="排序：收藏时间（新到旧）" aria-label="单词排序" aria-expanded="false"><span class="floating-word-book-filter-icon" aria-hidden="true"></span></button><div id="floatingWordBookSortMenu" class="floating-word-book-sort-menu" hidden><button type="button" data-sort-kind="saved" data-tip="按收藏时间"><span class="floating-word-book-clock-icon" aria-hidden="true"></span><span class="floating-word-book-sort-direction" aria-hidden="true"></span></button><button type="button" data-sort-kind="alpha" data-tip="按英文首字母"><span class="floating-word-book-alpha-icon" aria-hidden="true">A-z</span><span class="floating-word-book-sort-direction" aria-hidden="true"></span></button></div></div><button id="floatingClearWordBook" class="danger floating-word-book-clear" type="button">清空单词本</button></div><div id="floatingWordBookList" class="floating-word-book-list"><div class="empty">读取中...</div></div>';
  const search = body.querySelector("#floatingWordBookSearch");
  const sortControl = body.querySelector("#floatingWordBookSortControl");
  const sortTrigger = body.querySelector("#floatingWordBookSortTrigger");
  const sortMenu = body.querySelector("#floatingWordBookSortMenu");
  const clearButton = body.querySelector("#floatingClearWordBook");
  const list = body.querySelector("#floatingWordBookList");
  let sortValue = "saved-desc";
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-word-book" });
    if (!response?.ok) throw new Error(response?.error || "读取单词本失败");
    const words = response.words || [];
    const renderList = () => {
      const keyword = search.value.trim().toLowerCase();
      const filtered = sortWordBookEntries(words.filter((item) => !keyword || [item.word, item.lemma, item.partOfSpeech, ...(item.meanings || [])]
        .join(" ").toLowerCase().includes(keyword)), sortValue);
      if (!filtered.length) {
        list.innerHTML = `<div class="empty">${keyword ? "没有找到匹配的单词" : "单词本还是空的"}</div>`;
        return;
      }
      list.innerHTML = filtered.map((item) => `
        <article class="floating-word-book-item" data-word-key="${escapeHtml(item.key)}" tabindex="0">
          <div class="floating-word-book-head">
            <span class="floating-word-book-word">${escapeHtml(item.word || item.lemma)}</span>
            <span class="floating-word-book-meta">${escapeHtml([item.phonetic, item.partOfSpeech].filter(Boolean).join(" · "))}</span>
            <button class="floating-word-book-remove" type="button" data-remove-word="${escapeHtml(item.key)}">删除</button>
          </div>
          <div class="floating-word-book-meaning">${escapeHtml((item.meanings || []).join("；") || item.contextMeaning || "暂无释义")}</div>
          <div class="floating-word-book-footer">收藏于 ${escapeHtml(formatDate(item.savedAt) || "未知")}</div>
        </article>
      `).join("");
      list.querySelectorAll("[data-remove-word]").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          const response = await chrome.runtime.sendMessage({ type: "remove-word-book-entry", key: button.dataset.removeWord });
          if (!response?.ok) {
            setFloatingStatus(status, response?.error || "删除失败", true);
            return;
          }
          const index = words.findIndex((item) => item.key === button.dataset.removeWord);
          if (index >= 0) words.splice(index, 1);
          renderList();
        });
      });
      list.querySelectorAll(".floating-word-book-item").forEach((item) => {
        const openEntry = () => {
          const entry = words.find((word) => word.key === item.dataset.wordKey);
          if (entry) openSavedWordPopover(entry, item.getBoundingClientRect());
        };
        item.addEventListener("click", (event) => {
          if (event.target.closest("[data-remove-word]")) return;
          event.stopPropagation();
          openEntry();
        });
        item.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openEntry();
          }
        });
      });
    };
    const updateSortUi = () => {
      const [kind, direction] = sortValue.split("-");
      const labels = {
        "saved-asc": "排序：收藏时间（旧到新）",
        "saved-desc": "排序：收藏时间（新到旧）",
        "alpha-asc": "排序：英文首字母（A-Z）",
        "alpha-desc": "排序：英文首字母（Z-A）"
      };
      const label = labels[sortValue] || labels["saved-desc"];
      sortTrigger.dataset.tip = label;
      sortTrigger.title = label;
      sortMenu.querySelectorAll("[data-sort-kind]").forEach((button) => {
        const selected = button.dataset.sortKind === kind;
        button.classList.toggle("is-active", selected);
        button.querySelector(".floating-word-book-sort-direction").textContent = selected ? (direction === "asc" ? "↑" : "↓") : "↕";
      });
    };
    sortTrigger.addEventListener("click", () => {
      sortMenu.hidden = !sortMenu.hidden;
      sortTrigger.setAttribute("aria-expanded", String(!sortMenu.hidden));
    });
    sortMenu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-sort-kind]");
      if (!button) return;
      const kind = button.dataset.sortKind;
      const [currentKind, currentDirection] = sortValue.split("-");
      sortValue = currentKind === kind
        ? `${kind}-${currentDirection === "asc" ? "desc" : "asc"}`
        : `${kind}-${kind === "saved" ? "desc" : "asc"}`;
      sortMenu.hidden = true;
      sortTrigger.setAttribute("aria-expanded", "false");
      updateSortUi();
      renderList();
    });
    body.addEventListener("pointerdown", (event) => {
      if (!sortControl.contains(event.target)) {
        sortMenu.hidden = true;
        sortTrigger.setAttribute("aria-expanded", "false");
      }
    });
    clearButton.addEventListener("click", async () => {
      if (!await showFloatingConfirmDialog(clearButton, "确定清空单词本吗？")) return;
      try {
        const clearResponse = await chrome.runtime.sendMessage({ type: "clear-word-book" });
        if (!clearResponse?.ok) throw new Error(clearResponse?.error || "清空失败");
        words.splice(0, words.length);
        search.value = "";
        renderList();
        setFloatingStatus(status, "单词本已清空");
      } catch (error) {
        setFloatingStatus(status, error.message || String(error), true);
      }
    });
    search.addEventListener("input", renderList);
    updateSortUi();
    renderList();
  } catch (error) {
    list.innerHTML = `<div class="empty">${escapeHtml(error.message || String(error))}</div>`;
    setFloatingStatus(status, error.message || String(error), true);
  }
}

function sortWordBookEntries(words, sort) {
  return words.slice().sort((a, b) => {
    if (sort === "saved-asc") return Number(a.savedAt || 0) - Number(b.savedAt || 0);
    if (sort === "alpha-asc") return String(a.word || a.lemma || "").localeCompare(String(b.word || b.lemma || ""), "en", { sensitivity: "base" });
    if (sort === "alpha-desc") return String(b.word || b.lemma || "").localeCompare(String(a.word || a.lemma || ""), "en", { sensitivity: "base" });
    return Number(b.savedAt || 0) - Number(a.savedAt || 0);
  });
}

async function renderFloatingSettings({ title, status, body }) {
  title.textContent = "AI 配置";
  body.innerHTML = `
    <label class="field">Base URL<input id="floatingBaseUrl" type="url" /></label>
    <label class="field api-key-field">API Key<input id="floatingApiKey" type="password" autocomplete="off" /><span class="api-key-tip">仅保存在本机浏览器中，只用于翻译和连接测试。</span></label>
    <label class="field">模型名称<input id="floatingModel" type="text" /></label>
    <button class="primary" id="floatingSaveSettings" type="button">保存并测试</button>
  `;

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  body.querySelector("#floatingBaseUrl").value = settings.baseUrl || "";
  body.querySelector("#floatingApiKey").value = settings.apiKey || "";
  body.querySelector("#floatingModel").value = settings.model || "";

  body.querySelector("#floatingSaveSettings").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const next = {
      ...DEFAULT_SETTINGS,
      baseUrl: body.querySelector("#floatingBaseUrl").value.trim(),
      apiKey: body.querySelector("#floatingApiKey").value.trim(),
      model: body.querySelector("#floatingModel").value.trim(),
      targetLanguage: "中文"
    };
    button.disabled = true;
    button.textContent = "测试中";
    setFloatingStatus(status, "正在测试连接");
    try {
      await chrome.storage.sync.set(next);
      const response = await chrome.runtime.sendMessage({ type: "test-connection", settings: next });
      if (!response?.ok) throw new Error(response?.error || "连接失败");
      setFloatingStatus(status, "连接成功");
    } catch (error) {
      setFloatingStatus(status, error.message || String(error), true);
    } finally {
      button.disabled = false;
      button.textContent = "保存并测试";
    }
  });
}

function renderFloatingSelfTranslate({ title, status, body }) {
  title.textContent = "自助翻译";
  body.innerHTML = `
    <div class="translate-controls">
      <select id="floatingSourceLanguage" aria-label="原语言">
        ${SELF_SOURCE_LANGUAGES.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}
      </select>
      <button class="swap-button" id="floatingSwapLanguages" type="button" aria-label="反转翻译">
        <span class="swap-icon" aria-hidden="true">
          <span class="swap-icon-line swap-icon-top"></span>
          <span class="swap-icon-line swap-icon-bottom"></span>
        </span>
      </button>
      <select id="floatingTargetLanguage" aria-label="目标语言">
        ${SELF_TARGET_LANGUAGES.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}
      </select>
      <button class="primary" id="floatingSelfTranslate" type="button">翻译</button>
    </div>
    <textarea id="floatingSourceText" placeholder="输入要翻译的内容"></textarea>
    <div class="result-wrap">
      <div id="floatingResultText" class="floating-learning-result" role="textbox" aria-readonly="true" data-placeholder="翻译结果"></div>
      <button class="copy-mini" id="floatingCopyResult" type="button" data-tip="复制" aria-label="复制"><span class="copy-icon" aria-hidden="true"></span></button>
    </div>
  `;

  const sourceLanguage = body.querySelector("#floatingSourceLanguage");
  const target = body.querySelector("#floatingTargetLanguage");
  const source = body.querySelector("#floatingSourceText");
  const result = body.querySelector("#floatingResultText");

  chrome.storage.local.get({
    selfSourceLanguage: "自动识别",
    selfTargetLanguage: "自动（中英互译）"
  }).then((stored) => {
    sourceLanguage.value = Array.from(sourceLanguage.options).some((option) => option.value === stored.selfSourceLanguage)
      ? stored.selfSourceLanguage
      : "自动识别";
    sourceLanguage.dataset.autoDetected = sourceLanguage.value === "自动识别" ? "true" : "false";
    target.value = stored.selfTargetLanguage === "自动识别（中英互译）" ? "自动（中英互译）" : stored.selfTargetLanguage;
  });
  sourceLanguage.addEventListener("change", () => {
    sourceLanguage.dataset.autoDetected = sourceLanguage.value === "自动识别" ? "true" : "false";
    chrome.storage.local.set({ selfSourceLanguage: sourceLanguage.value });
  });
  target.addEventListener("change", () => {
    chrome.storage.local.set({ selfTargetLanguage: target.value });
  });
  source.addEventListener("input", () => {
    if (sourceLanguage.dataset.autoDetected !== "true" && sourceLanguage.value !== "自动识别") return;
    const detected = detectLanguageName(source.value);
    if (detected && Array.from(sourceLanguage.options).some((option) => option.value === detected)) {
      sourceLanguage.value = detected;
      sourceLanguage.dataset.autoDetected = "true";
      chrome.storage.local.set({ selfSourceLanguage: detected });
    } else if (!source.value.trim()) {
      sourceLanguage.value = "自动识别";
      sourceLanguage.dataset.autoDetected = "true";
      chrome.storage.local.set({ selfSourceLanguage: "自动识别" });
    }
  });
  source.addEventListener("keydown", (event) => {
    if (
      event.key !== "Enter" ||
      event.isComposing ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      event.metaKey
    ) return;
    event.preventDefault();
    const translateButton = body.querySelector("#floatingSelfTranslate");
    if (!translateButton.disabled) translateButton.click();
  });

  body.querySelector("#floatingSwapLanguages").addEventListener("click", (event) => {
    animateFloatingSwapButton(event.currentTarget);
    const nextSource = target.value === "自动（中英互译）" ? "自动识别" : target.value;
    const nextTarget = sourceLanguage.value === "自动识别" ? "自动（中英互译）" : sourceLanguage.value;
    sourceLanguage.value = Array.from(sourceLanguage.options).some((option) => option.value === nextSource) ? nextSource : "自动识别";
    target.value = Array.from(target.options).some((option) => option.value === nextTarget) ? nextTarget : "自动（中英互译）";
    sourceLanguage.dataset.autoDetected = sourceLanguage.value === "自动识别" ? "true" : "false";
    chrome.storage.local.set({
      selfSourceLanguage: sourceLanguage.value,
      selfTargetLanguage: target.value
    });
    if (getFloatingLearningText(result)) {
      const sourceText = source.value;
      source.value = getFloatingLearningText(result);
      setFloatingLearningResult(result, sourceText);
    }
  });

  body.querySelector("#floatingSelfTranslate").addEventListener("click", async (event) => {
    const text = source.value.trim();
    if (!text) {
      setFloatingStatus(status, "请输入原文", true);
      return;
    }

    const singleWord = getSingleEnglishWord(text);
    const wordBusyRequestId = singleWord ? `floating-self-word-${Date.now()}` : "";
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "翻译中";
    setFloatingLearningResult(result, "");
    setFloatingStatus(status, "正在翻译");
    try {
      if (singleWord) {
        setFloatingAssistantTranslationBusy(wordBusyRequestId, true);
        const response = await chrome.runtime.sendMessage({
          type: "lookup-english-word",
          word: singleWord,
          sentence: ""
        });
        if (!response?.ok) throw new Error(response?.error || "查词失败");
        setFloatingInlineWordResult(result, { ...response.entry, contextMeaning: "" }, status);
        setFloatingStatus(status, "单词资料已生成");
        return;
      }
      const response = await chrome.runtime.sendMessage({
        type: "translate-self",
        text,
        sourceLanguage: sourceLanguage.value,
        targetLanguage: target.value
      });
      if (!response?.ok) throw new Error(response?.error || "翻译失败");
      setFloatingLearningResult(result, response.translation || "", text);
      setFloatingStatus(status, "翻译完成");
    } catch (error) {
      setFloatingStatus(status, error.message || String(error), true);
    } finally {
      if (wordBusyRequestId) setFloatingAssistantTranslationBusy(wordBusyRequestId, false);
      button.disabled = false;
      button.textContent = "翻译";
    }
  });

  body.querySelector("#floatingCopyResult").addEventListener("click", async () => {
    if (!getFloatingLearningText(result)) {
      setFloatingStatus(status, "暂无译文", true);
      return;
    }
    const copied = await copyText(getFloatingLearningText(result));
    setFloatingStatus(status, copied ? "已复制" : "复制失败", !copied);
  });
}

function animateFloatingSwapButton(button) {
  button.classList.remove("is-swapping");
  void button.offsetWidth;
  button.classList.add("is-swapping");
  button.addEventListener("animationend", () => button.classList.remove("is-swapping"), { once: true });
}

function getFloatingLearningText(element) {
  return String(element.dataset.translation ?? element.textContent ?? "").trim();
}

function setFloatingLearningResult(element, text, sourceText = "") {
  element.textContent = "";
  element.classList.remove("is-word-result");
  const value = String(text || "");
  element.dataset.translation = value;
  if (!value && !sourceText) return;
  if (sourceText && /[A-Za-z]/.test(sourceText)) {
    const source = document.createElement("div");
    source.className = "floating-learning-source";
    appendFloatingLearningWords(source, String(sourceText), String(sourceText));
    element.append(source);
  }
  const translation = document.createElement("div");
  translation.className = "floating-learning-translation";
  appendFloatingLearningWords(translation, value, value);
  element.append(translation);
}

function setFloatingInlineWordResult(element, entry, status) {
  element.textContent = "";
  element.classList.add("is-word-result");
  element.dataset.translation = formatWordDetailsForCopy(entry);
  element.innerHTML = `
    <div class="inline-word-head">
      <div class="inline-word-language">英语</div>
      <div class="inline-word-title">${escapeHtml(entry.word || entry.lemma)}</div>
      <div class="inline-word-meta">${escapeHtml([entry.phonetic, formatWordPartOfSpeech(entry.partOfSpeech)].filter(Boolean).join(" · "))}</div>
    </div>
    <button class="inline-word-favorite ${entry.favorite ? "is-active" : ""}" type="button" data-tip="${entry.favorite ? "移出单词本" : "收藏到单词本"}" aria-label="${entry.favorite ? "移出单词本" : "收藏到单词本"}"><span class="inline-word-star ${entry.favorite ? "is-filled" : ""}" aria-hidden="true"></span></button>
    ${entry.contextMeaning ? `<div class="inline-word-section"><div class="inline-word-label">当前语境</div><div class="inline-word-value">${escapeHtml(entry.contextMeaning)}</div></div>` : ""}
    <div class="inline-word-section"><div class="inline-word-label">${escapeHtml(formatWordPartOfSpeech(entry.partOfSpeech))}</div><ol class="inline-word-meanings">${(entry.meanings || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无释义</li>"}</ol></div>
    ${entry.forms?.length ? `<div class="inline-word-section"><div class="inline-word-label">词形</div><div class="inline-word-value">${escapeHtml(entry.forms.join(" · "))}</div></div>` : ""}
    ${entry.example ? `<div class="inline-word-section"><div class="inline-word-label">示例</div><div class="inline-word-value is-example">${escapeHtml(entry.example)}${entry.exampleTranslation ? `<br>${escapeHtml(entry.exampleTranslation)}` : ""}</div></div>` : ""}
  `;

  const favoriteButton = element.querySelector(".inline-word-favorite");
  favoriteButton.addEventListener("click", async () => {
    const previousFavorite = Boolean(entry.favorite);
    entry.favorite = !previousFavorite;
    favoriteButton.classList.toggle("is-active", entry.favorite);
    favoriteButton.querySelector(".inline-word-star")?.classList.toggle("is-filled", entry.favorite);
    favoriteButton.dataset.tip = entry.favorite ? "移出单词本" : "收藏到单词本";
    favoriteButton.setAttribute("aria-label", favoriteButton.dataset.tip);
    const response = await chrome.runtime.sendMessage({ type: "toggle-word-favorite", entry });
    if (!response?.ok) {
      entry.favorite = previousFavorite;
      favoriteButton.classList.toggle("is-active", previousFavorite);
      favoriteButton.querySelector(".inline-word-star")?.classList.toggle("is-filled", previousFavorite);
      favoriteButton.dataset.tip = previousFavorite ? "移出单词本" : "收藏到单词本";
      favoriteButton.setAttribute("aria-label", favoriteButton.dataset.tip);
      setFloatingStatus(status, response?.error || "收藏失败", true);
      return;
    }
    entry.favorite = response.favorite;
    favoriteButton.classList.toggle("is-active", entry.favorite);
    favoriteButton.querySelector(".inline-word-star")?.classList.toggle("is-filled", entry.favorite);
    favoriteButton.dataset.tip = entry.favorite ? "移出单词本" : "收藏到单词本";
    favoriteButton.setAttribute("aria-label", favoriteButton.dataset.tip);
    setFloatingStatus(status, entry.favorite ? "已加入单词本" : "已移出单词本");
  });
}

function appendFloatingLearningWords(container, value, sentence) {
  const fragment = document.createDocumentFragment();
  const pattern = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;
  let index = 0;
  for (const match of value.matchAll(pattern)) {
    fragment.append(value.slice(index, match.index));
    const word = document.createElement("button");
    word.type = "button";
    word.className = "floating-learn-word";
    word.textContent = match[0];
    word.title = "点击查看单词学习资料";
    word.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openWordPopover(match[0], sentence, word.getBoundingClientRect());
    });
    fragment.append(word);
    index = match.index + match[0].length;
  }
  fragment.append(value.slice(index));
  container.append(fragment);
}

async function renderFloatingHistory({ title, status, body }) {
  title.textContent = "历史记录";
  body.innerHTML = '<div class="empty">读取中...</div>';
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-history" });
    if (!response?.ok) throw new Error(response?.error || "读取失败");
    const history = response.history || [];
    body.innerHTML = `
      <div class="toolbar">
        <select id="floatingHistoryFilter" aria-label="历史类型">
          <option value="all">全部类型</option>
          <option value="selection">随手划</option>
          <option value="page">整页翻译</option>
          <option value="self">自助翻译</option>
        </select>
        <input id="floatingHistorySearch" class="history-search" type="search" placeholder="搜索历史" autocomplete="off" />
        <button class="danger" id="floatingClearHistory" type="button">清空历史</button>
      </div>
      <div id="floatingHistoryList"></div>
    `;
    const filter = body.querySelector("#floatingHistoryFilter");
    const search = body.querySelector("#floatingHistorySearch");
    const list = body.querySelector("#floatingHistoryList");
    const renderList = () => renderFloatingHistoryList(list, history, filter.value, search.value);
    filter.addEventListener("change", renderList);
    search.addEventListener("input", renderList);
    const clearHistoryButton = body.querySelector("#floatingClearHistory");
    clearHistoryButton.addEventListener("click", async () => {
      const confirmed = await showFloatingConfirmDialog(clearHistoryButton, "确定清空全部翻译历史吗？");
      if (!confirmed) return;
      const clearResponse = await chrome.runtime.sendMessage({ type: "clear-history" });
      if (!clearResponse?.ok) {
        setFloatingStatus(status, clearResponse?.error || "清空失败", true);
        return;
      }
      renderFloatingHistoryList(list, [], "all", "");
      setFloatingStatus(status, "历史已清空");
    });
    renderList();
  } catch (error) {
    body.innerHTML = `<div class="empty">${escapeHtml(error.message || String(error))}</div>`;
    setFloatingStatus(status, error.message || String(error), true);
  }
}

function renderFloatingHistoryList(container, history, filter, keyword = "") {
  const normalizedKeyword = keyword.trim().toLowerCase();
  const filtered = history.filter((item) => {
    const matchesType = filter === "all" || item.mode === filter;
    if (!matchesType) return false;
    if (!normalizedKeyword) return true;
    return [
      item.source,
      item.translation,
      item.title,
      item.url,
      item.model,
      languagePair(item),
      modeLabel(item.mode, item.count)
    ].some((value) => String(value || "").toLowerCase().includes(normalizedKeyword));
  });
  if (!filtered.length) {
    container.innerHTML = `<div class="empty">${normalizedKeyword ? "没有找到匹配的翻译记录" : "最近 7 天还没有翻译记录"}</div>`;
    return;
  }

  container.innerHTML = filtered.slice(0, 40).map((item) => {
    const sourceRaw = item.source || "";
    const translationRaw = item.translation || "";
    const isLong = sourceRaw.length > 120 || translationRaw.length > 160;
    return `
      <article class="history-item" data-expanded="false" tabindex="0">
        <div class="history-top">
          <span class="history-badge ${escapeHtml(modeClass(item.mode))}">${escapeHtml(modeLabel(item.mode, item.count))}</span>
          <span class="history-lang">${escapeHtml(languagePair(item))}</span>
          <span class="history-time">${escapeHtml(formatDate(item.createdAt))}</span>
        </div>
        <div class="history-source">${escapeHtml(sourceRaw)}</div>
        <div class="history-translation">${escapeHtml(translationRaw)}</div>
        ${isLong ? '<div class="history-more">点击展开</div>' : ""}
      </article>
    `;
  }).join("");

  container.querySelectorAll(".history-item").forEach((item) => {
    const toggle = () => {
      const expanded = item.dataset.expanded === "true";
      item.dataset.expanded = String(!expanded);
      const more = item.querySelector(".history-more");
      if (more) more.textContent = expanded ? "点击展开" : "点击收起";
    };
    item.addEventListener("click", (event) => {
      if (!event.target.closest(".history-top, .history-more")) return;
      toggle();
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  });
}

async function renderFloatingUsage({ title, status, body }) {
  title.textContent = "Token 用量";
  body.innerHTML = '<div class="empty">读取中...</div>';
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-token-stats" });
    if (!response?.ok) throw new Error(response?.error || "读取失败");
    const stats = response.stats || {};
    const recent = stats.recent || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const total = stats.total || { totalTokens: 0 };
    const modes = Object.entries(stats.byMode || {})
      .sort((a, b) => (b[1]?.totalTokens || 0) - (a[1]?.totalTokens || 0));
    const max = Math.max(1, ...modes.map(([, usage]) => usage.totalTokens || 0));
    body.innerHTML = `
      <div class="usage-grid">
        ${usageCard("近 7 天", recent.totalTokens)}
        ${usageCard("累计使用", total.totalTokens)}
        ${usageCard("输入 Token", recent.promptTokens)}
        ${usageCard("输出 Token", recent.completionTokens)}
      </div>
      <div class="usage-bars">
      ${modes.length ? modes.map(([mode, usage]) => `
        <div class="usage-line">
          <div class="usage-bar-head">
            <span>${escapeHtml(modeLabel(mode))}</span>
            <span>${formatNumber(usage.totalTokens || 0)}</span>
          </div>
          <div class="usage-bar"><span class="usage-bar-fill ${escapeHtml(modeClass(mode))}" style="width:${Math.max(4, Math.round((usage.totalTokens || 0) / max * 100))}%"></span></div>
        </div>
      `).join("") : '<div class="empty">暂无 Token 统计</div>'}
      </div>
      <button class="danger" id="floatingClearUsage" type="button">清空统计</button>
    `;
    const clearUsageButton = body.querySelector("#floatingClearUsage");
    clearUsageButton?.addEventListener("click", async () => {
      if (!await showFloatingConfirmDialog(clearUsageButton, "确定清空 Token 统计数据吗？")) return;
      const response = await chrome.runtime.sendMessage({ type: "clear-token-stats" });
      if (!response?.ok) {
        setFloatingStatus(status, response?.error || "清空失败", true);
        return;
      }
      renderFloatingUsage({ title, status, body });
    });
  } catch (error) {
    body.innerHTML = `<div class="empty">${escapeHtml(error.message || String(error))}</div>`;
    setFloatingStatus(status, error.message || String(error), true);
  }
}

function showFloatingConfirmDialog(source, message) {
  return new Promise((resolve) => {
    const panel = source.closest(".floating-panel");
    if (!panel) {
      resolve(false);
      return;
    }
    panel.querySelector(".panel-confirm-layer")?.remove();

    const layer = document.createElement("div");
    layer.className = "panel-confirm-layer";
    layer.innerHTML = `
      <div class="panel-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="floatingConfirmTitle" aria-describedby="floatingConfirmMessage">
        <div class="panel-confirm-title" id="floatingConfirmTitle">请确认</div>
        <div class="panel-confirm-message" id="floatingConfirmMessage">${escapeHtml(message)}</div>
        <div class="panel-confirm-note">清空后无法恢复</div>
        <div class="panel-confirm-actions">
          <button class="panel-confirm-cancel" type="button">取消</button>
          <button class="panel-confirm-danger" type="button">确认清空</button>
        </div>
      </div>
    `;

    const finish = (confirmed) => {
      document.removeEventListener("keydown", onKeyDown, true);
      layer.remove();
      resolve(confirmed);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish(false);
    };

    layer.addEventListener("click", (event) => {
      if (event.target === layer) finish(false);
    });
    layer.querySelector(".panel-confirm-cancel").addEventListener("click", () => finish(false));
    layer.querySelector(".panel-confirm-danger").addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKeyDown, true);
    panel.appendChild(layer);
    layer.querySelector(".panel-confirm-cancel").focus();
  });
}

function setFloatingStatus(status, message, isError = false) {
  status.textContent = message;
  status.title = message;
  status.dataset.state = isError ? "error" : "";
  window.clearTimeout(setFloatingStatus.timer);
  setFloatingStatus.timer = window.setTimeout(() => {
    status.textContent = "";
    status.title = "";
    status.dataset.state = "";
  }, isError ? 8000 : 2400);
}

function usageCard(label, value) {
  return `
    <div class="usage-card">
      <div class="usage-label">${escapeHtml(label)}</div>
      <div class="usage-value">${escapeHtml(formatNumber(value))}</div>
    </div>
  `;
}

function modeLabel(mode, count) {
  if (mode === "selection") return "随手划";
  if (mode === "page") return `整页翻译${count ? ` · ${count} 段` : ""}`;
  if (mode === "self") return "自助翻译";
  if (mode === "word") return "单词学习";
  if (mode === "test") return "连接测试";
  return "其他";
}

function modeClass(mode) {
  if (mode === "page") return "page";
  if (mode === "self") return "self";
  if (mode === "word") return "word";
  if (mode === "test") return "test";
  return "selection";
}

function languagePair(item) {
  const source = item.sourceLanguage || "自动识别";
  const target = item.targetLanguage || "中文";
  return `${source} → ${target}`;
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value || 0));
}

function detectLanguageName(text) {
  const value = text.trim();
  if (!value) return "";
  const counts = [
    ["中文", /[\u4e00-\u9fff]/g],
    ["日文", /[\u3040-\u30ff]/g],
    ["韩文", /[\uac00-\ud7af]/g],
    ["俄文", /[\u0400-\u04ff]/g],
    ["阿拉伯文", /[\u0600-\u06ff]/g],
    ["希腊文", /[\u0370-\u03ff]/g],
    ["希伯来文", /[\u0590-\u05ff]/g],
    ["泰文", /[\u0e00-\u0e7f]/g]
  ].map(([language, pattern]) => [language, (value.match(pattern) || []).length]);
  const [language, count] = counts.sort((a, b) => b[1] - a[1])[0];
  if (count > 0) return language;
  return /[a-zA-Z]/.test(value) ? "英文" : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

const style = document.createElement("style");
style.textContent = `
  .model-translator-bilingual-segment {
    display: inline;
  }

  .model-translator-bilingual-translation {
    color: inherit;
  }

  .model-translator-bilingual-original {
    margin-left: 0.35em;
    color: #94a3b8;
    font-size: 0.84em;
    font-style: italic;
  }

  .model-translator-bilingual-original::before {
    content: "(";
  }

  .model-translator-bilingual-original::after {
    content: ")";
  }

  .model-translator-bilingual-segment.is-stacked {
    display: block;
  }

  .model-translator-bilingual-segment.is-stacked .model-translator-bilingual-translation,
  .model-translator-bilingual-segment.is-stacked .model-translator-bilingual-original {
    display: block;
    margin-left: 0;
  }

  .model-translator-bilingual-segment.is-stacked .model-translator-bilingual-original::before,
  .model-translator-bilingual-segment.is-stacked .model-translator-bilingual-original::after {
    content: none;
  }

  #${BUTTON_ID} {
    position: absolute;
    z-index: 2147483647;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #409eff;
    box-shadow: none;
    cursor: pointer;
    font: 700 15px/32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-align: center;
    transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
  }

  #${BUTTON_ID} img {
    display: block;
    width: 32px;
    height: 32px;
    pointer-events: none;
    filter:
      drop-shadow(0 2px 3px rgba(51, 65, 85, 0.16))
      drop-shadow(0 4px 7px rgba(64, 158, 255, 0.2));
    transition: filter 140ms ease;
  }

  #${BUTTON_ID}:hover {
    background: transparent;
    transform: translateY(-1px) scale(1.03);
    box-shadow: none;
  }

  #${BUTTON_ID}:hover img {
    filter:
      drop-shadow(0 2px 3px rgba(51, 65, 85, 0.2))
      drop-shadow(0 5px 9px rgba(64, 158, 255, 0.28));
  }

  #${BUTTON_ID}:active:not(:disabled) {
    transform: translateY(0) scale(0.96);
  }

  #${BUTTON_ID}:disabled {
    cursor: wait;
    opacity: 0.75;
  }

  .model-translator-loading-dots {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    width: 20px;
    height: 32px;
  }

  .model-translator-loading-dots span {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.28;
    transform: scale(0.82);
    animation: modelTranslatorDotFocus 900ms infinite ease-in-out;
  }

  .model-translator-loading-dots span:nth-child(2) {
    animation-delay: 150ms;
  }

  .model-translator-loading-dots span:nth-child(3) {
    animation-delay: 300ms;
  }

  @keyframes modelTranslatorDotFocus {
    0%, 100% {
      opacity: 0.28;
      transform: scale(0.82);
    }
    35% {
      opacity: 1;
      transform: scale(1.25);
    }
  }

  @keyframes modelTranslatorPopoverBloom {
    0% {
      opacity: 0.96;
      border-radius: 999px;
      transform: translate(var(--model-translator-start-x), var(--model-translator-start-y)) scale(var(--model-translator-start-scale-x), var(--model-translator-start-scale-y));
    }
    62% {
      opacity: 1;
      border-radius: 18px 18px 16px 22px;
      transform: translate(0, 0) scale(1.025);
    }
    100% {
      opacity: 1;
      border-radius: 8px;
      transform: translate(0, 0) scale(1);
    }
  }

  #${POPOVER_ID} {
    position: fixed;
    z-index: 2147483647;
    box-sizing: border-box;
    max-height: 280px;
    overflow: auto;
    border: 1px solid rgba(15, 23, 42, 0.14);
    border-radius: 8px;
    background: #ffffff;
    color: #111827;
    box-shadow: 0 18px 44px rgba(15, 23, 42, 0.2);
    padding: 12px;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    white-space: normal;
    transform-origin: center;
  }

  #${POPOVER_ID}.is-opening {
    animation: modelTranslatorPopoverBloom 340ms cubic-bezier(.18,.9,.2,1) both;
    will-change: transform, opacity, border-radius;
  }

  #${POPOVER_ID} .model-translator-popover-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 88px;
    color: #409eff;
    font: 650 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .model-translator-query-animation {
    display: block;
    width: 48px;
    height: 48px;
    pointer-events: none;
  }

  .model-translator-loading-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
  }

  #${POPOVER_ID} .model-translator-popover-loading .model-translator-loading-dots {
    height: 18px;
  }

  #${POPOVER_ID} .model-translator-popover-body {
    white-space: pre-wrap;
  }

  #${POPOVER_ID} .model-translator-popover-source {
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid #eef2f7;
    color: #64748b;
    font-size: 12px;
  }

  #${POPOVER_ID} .model-translator-learn-word {
    display: inline;
    margin: 0;
    padding: 0 1px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    line-height: inherit;
  }

  #${POPOVER_ID} .model-translator-learn-word:hover {
    background: #ecf5ff;
    color: #409eff;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  #${POPOVER_ID} .model-translator-popover-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 10px;
  }

  #${POPOVER_ID} .model-translator-popover-type {
    flex: 1;
    min-width: 0;
    color: #94a3b8;
    font: 500 11px/24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  #${POPOVER_ID} .model-translator-popover-copy {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    min-width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid #d8dee8;
    border-radius: 8px;
    background: #ffffff;
    color: #64748b;
    cursor: pointer;
    transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease;
  }

  #${POPOVER_ID} .model-translator-popover-copy:hover {
    border-color: #b3d8ff;
    background: #f4f9ff;
    color: #2563eb;
    transform: translateY(-1px);
  }

  #${POPOVER_ID} .model-translator-popover-copy:active {
    transform: translateY(0) scale(0.94);
  }

  #${POPOVER_ID} .model-translator-popover-copy[data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    z-index: 3;
    right: 0;
    bottom: calc(100% + 5px);
    padding: 4px 6px;
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.9);
    color: #ffffff;
    font: 600 9px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    opacity: 0;
    pointer-events: none;
    transform: translateY(2px);
    transition: opacity 120ms ease, transform 120ms ease;
    white-space: nowrap;
  }

  #${POPOVER_ID} .model-translator-popover-copy[data-tip]:hover::after,
  #${POPOVER_ID} .model-translator-popover-copy[data-tip]:focus-visible::after {
    opacity: 1;
    transform: translateY(0);
  }

  #${POPOVER_ID} .model-translator-copy-icon {
    display: inline-block;
    width: 14px;
    height: 14px;
    background: currentColor;
    mask: center / 14px 14px no-repeat url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='8.25' y='8.25' width='10.5' height='10.5' rx='1.75' fill='none' stroke='black' stroke-width='1.8'/%3E%3Cpath d='M15.75 8.25V6.5A1.5 1.5 0 0 0 14.25 5H6.5A1.5 1.5 0 0 0 5 6.5v7.75a1.5 1.5 0 0 0 1.5 1.5h1.75' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E");
    -webkit-mask: center / 14px 14px no-repeat url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='8.25' y='8.25' width='10.5' height='10.5' rx='1.75' fill='none' stroke='black' stroke-width='1.8'/%3E%3Cpath d='M15.75 8.25V6.5A1.5 1.5 0 0 0 14.25 5H6.5A1.5 1.5 0 0 0 5 6.5v7.75a1.5 1.5 0 0 0 1.5 1.5h1.75' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E");
  }

  #${POPOVER_ID}[data-state="error"] {
    border-color: rgba(185, 28, 28, 0.3);
    color: #991b1b;
    background: #fff7f7;
  }

  #${WORD_POPOVER_ID} {
    position: fixed;
    z-index: 2147483647;
    box-sizing: border-box;
    max-height: min(410px, calc(100vh - 24px));
    overflow: auto;
    padding: 14px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.98);
    color: #1f2937;
    box-shadow: 0 18px 46px rgba(15, 23, 42, 0.22);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  #${WORD_POPOVER_ID} .model-translator-word-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 112px;
    gap: 4px;
    color: #409eff;
    font-weight: 650;
  }

  #${WORD_POPOVER_ID} .model-translator-word-error {
    min-height: 64px;
    display: grid;
    place-items: center;
    color: #b91c1c;
    text-align: center;
  }

  #${WORD_POPOVER_ID} .model-translator-word-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  #${WORD_POPOVER_ID} .model-translator-word-drag-handle {
    display: block;
    min-height: 17px;
    margin-bottom: 1px;
    cursor: grab;
    touch-action: none;
  }

  #${WORD_POPOVER_ID} .model-translator-word-drag-handle.is-dragging {
    cursor: grabbing;
  }

  #${WORD_POPOVER_ID} .model-translator-word-title {
    margin-top: 3px;
    color: #e88b2d;
    font-size: 22px;
    font-weight: 750;
  }

  #${WORD_POPOVER_ID} .model-translator-word-meta {
    margin-top: 2px;
    color: #64748b;
    font-size: 11px;
  }

  #${WORD_POPOVER_ID} .model-translator-word-tools {
    display: flex;
    gap: 5px;
    margin-left: auto;
  }

  #${WORD_POPOVER_ID} .model-translator-word-tools button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    min-height: 26px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: #64748b;
    cursor: pointer;
    transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease;
  }

  #${WORD_POPOVER_ID} .model-translator-word-tools button[data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    z-index: 3;
    top: calc(100% + 6px);
    right: 0;
    padding: 5px 7px;
    border-radius: 7px;
    background: rgba(15, 23, 42, 0.9);
    color: #fff;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.2;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-3px);
    transition: opacity 120ms ease, transform 120ms ease;
    white-space: nowrap;
  }

  #${WORD_POPOVER_ID} .model-translator-word-tools button[data-tip]:hover::after,
  #${WORD_POPOVER_ID} .model-translator-word-tools button[data-tip]:focus-visible::after {
    opacity: 1;
    transform: translateY(0);
  }

  #${WORD_POPOVER_ID} .model-translator-word-tools button:hover,
  #${WORD_POPOVER_ID} .model-translator-word-tools button.is-active {
    border-color: #b3d8ff;
    background: #ecf5ff;
    color: #409eff;
  }

  #${WORD_POPOVER_ID} .model-translator-word-tools button:active {
    transform: scale(0.9);
  }

  #${WORD_POPOVER_ID} .model-translator-word-tools button.is-error {
    border-color: #fecaca;
    background: #fff1f2;
    color: #dc2626;
  }

  #${WORD_POPOVER_ID} .model-translator-word-tool-icon {
    display: inline-block;
    width: 14px;
    height: 14px;
    background: currentColor;
    mask-position: center;
    mask-repeat: no-repeat;
    mask-size: 14px 14px;
    -webkit-mask-position: center;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-size: 14px 14px;
  }

  #${WORD_POPOVER_ID} .icon-pin { mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='M9 3h6v5l3 3v2h-5v8h-2v-8H6v-2l3-3V3Zm2 2v3.8L8.8 11h6.4L13 8.8V5h-2Z'/%3E%3C/svg%3E"); -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='M9 3h6v5l3 3v2h-5v8h-2v-8H6v-2l3-3V3Zm2 2v3.8L8.8 11h6.4L13 8.8V5h-2Z'/%3E%3C/svg%3E"); }
  #${WORD_POPOVER_ID} .icon-copy { mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='8.25' y='8.25' width='10.5' height='10.5' rx='1.75' fill='none' stroke='black' stroke-width='1.8'/%3E%3Cpath d='M15.75 8.25V6.5A1.5 1.5 0 0 0 14.25 5H6.5A1.5 1.5 0 0 0 5 6.5v7.75a1.5 1.5 0 0 0 1.5 1.5h1.75' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E"); -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='8.25' y='8.25' width='10.5' height='10.5' rx='1.75' fill='none' stroke='black' stroke-width='1.8'/%3E%3Cpath d='M15.75 8.25V6.5A1.5 1.5 0 0 0 14.25 5H6.5A1.5 1.5 0 0 0 5 6.5v7.75a1.5 1.5 0 0 0 1.5 1.5h1.75' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E"); }
  #${WORD_POPOVER_ID} .icon-star { mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.2' stroke-linejoin='round' d='m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.7l6.2-.9L12 3Z'/%3E%3C/svg%3E"); -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.2' stroke-linejoin='round' d='m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.7l6.2-.9L12 3Z'/%3E%3C/svg%3E"); }
  #${WORD_POPOVER_ID} [data-word-favorite].is-active .icon-star, #${WORD_POPOVER_ID} .icon-star.is-filled { mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='m12 2.8 2.9 5.9 6.5.9-4.7 4.5 1.1 6.4-5.8-3.1-5.8 3.1 1.1-6.4-4.7-4.5 6.5-.9L12 2.8Z'/%3E%3C/svg%3E"); -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='m12 2.8 2.9 5.9 6.5.9-4.7 4.5 1.1 6.4-5.8-3.1-5.8 3.1 1.1-6.4-4.7-4.5 6.5-.9L12 2.8Z'/%3E%3C/svg%3E"); }
  #${WORD_POPOVER_ID} .icon-close { mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' d='m7 7 10 10m0-10L7 17'/%3E%3C/svg%3E"); -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' d='m7 7 10 10m0-10L7 17'/%3E%3C/svg%3E"); }
  #${WORD_POPOVER_ID} .model-translator-word-tool-icon.icon-pin { mask-size: 15px 15px; -webkit-mask-size: 15px 15px; }
  #${WORD_POPOVER_ID} .model-translator-word-tool-icon.icon-copy { mask-size: 14px 14px; -webkit-mask-size: 14px 14px; }
  #${WORD_POPOVER_ID} .model-translator-word-tool-icon.icon-star { mask-size: 12.5px 12.5px; -webkit-mask-size: 12.5px 12.5px; }
  #${WORD_POPOVER_ID} .model-translator-word-tool-icon.icon-close { mask-size: 18px 18px; -webkit-mask-size: 18px 18px; }

  #${WORD_POPOVER_ID} .model-translator-word-language {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #64748b;
    font-size: 11px;
  }

  #${WORD_POPOVER_ID} .model-translator-word-section {
    margin-top: 13px;
  }

  #${WORD_POPOVER_ID} .model-translator-word-label {
    color: #8b5cf6;
    font-size: 11px;
  }

  #${WORD_POPOVER_ID} .model-translator-word-value {
    margin-top: 3px;
    white-space: pre-wrap;
    color: #475569;
    line-height: 1.62;
  }

  #${WORD_POPOVER_ID} .model-translator-word-section.is-meaning .model-translator-word-value {
    color: #2563eb;
  }

  #${WORD_POPOVER_ID} .model-translator-word-value.is-example {
    color: #64748b;
    font-style: italic;
  }
`;
document.documentElement.appendChild(style);
})();
