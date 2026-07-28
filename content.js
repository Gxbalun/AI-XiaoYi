(() => {
const CONTENT_VERSION = "1.1.3";
if (window.__MODEL_TRANSLATOR_CONTENT_VERSION__ === CONTENT_VERSION) {
  return;
}
window.__MODEL_TRANSLATOR_CONTENT_LOADED__ = true;
window.__MODEL_TRANSLATOR_CONTENT_VERSION__ = CONTENT_VERSION;

const BUTTON_ID = "model-translator-selection-button-v2";
const POPOVER_ID = "model-translator-popover-v2";
const WORD_POPOVER_ID = "model-translator-word-popover-v2";
const FLOATING_HOST_ID = "model-translator-floating-host-v2";
const FLOATING_POSITION_KEY = "floatingButtonPosition";
const FLOATING_PANEL_PREFERENCES_KEY = "floatingPanelPreferences";
const PANEL_OPACITY_MIN = 30;
const PANEL_OPACITY_MID = 70;
const PANEL_OPACITY_MAX = 100;
const ASSISTANT_MODE_ENABLED_KEY = "assistantModeEnabled";
const ASSISTANT_MODE_PAUSED_UNTIL_KEY = "assistantModePausedUntil";
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
const PAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_PERSISTENT_CACHE_KEY = "pageTranslationPersistentCacheV2";
const PAGE_PERSISTENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_PERSISTENT_CACHE_MAX = 1200;

let currentSelection = "";
let currentRange = null;
let translatedNodes = [];
let translatedNodeSet = new WeakSet();
let pageTranslationDisplayMode = "translated";
let pageTranslationRunning = false;
let pageTranslationEnabled = false;
let pageTranslationQueued = false;
let pageTranslationCancelToken = 0;
let pageTranslationRequestId = "";
let pageLazyTimer = 0;
let pageHoverTimer = 0;
let pageMutationObserver = null;
let pagePersistentCacheLoaded = false;
let pagePersistentCache = {};
const pageTranslationCache = new Map();

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
document.addEventListener("fullscreenchange", syncAssistantModeVisibility);

syncAssistantModeVisibility();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes[ASSISTANT_MODE_ENABLED_KEY] || changes[ASSISTANT_MODE_PAUSED_UNTIL_KEY])
  ) {
    syncAssistantModeVisibility();
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
    sendResponse({ ok: true, translated: translatedNodes.length > 0, bilingual: pageTranslationDisplayMode === "bilingual" });
  }
});

function handleSelectionChange(pointerPosition = null) {
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
  if (!rect) return;

  let button = document.getElementById(BUTTON_ID);
  if (!button) {
    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "译";
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
  const anchorX = hasPointerPosition ? pointerPosition.clientX : rect.right;
  const anchorY = hasPointerPosition ? pointerPosition.clientY : rect.bottom;
  let clientLeft = anchorX + pointerGap;
  let clientTop = anchorY + pointerGap;

  if (clientLeft + buttonSize > window.innerWidth - viewportGap) {
    clientLeft = anchorX - buttonSize - pointerGap;
  }
  if (clientTop + buttonSize > window.innerHeight - viewportGap) {
    clientTop = anchorY - buttonSize - pointerGap;
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
  body.innerHTML = '<span>翻译中</span><span class="model-translator-loading-dots" aria-hidden="true"><span></span><span></span><span></span></span>';

  const footer = document.createElement("div");
  footer.className = "model-translator-popover-footer";

  const typeLabel = document.createElement("span");
  typeLabel.className = "model-translator-popover-type";
  typeLabel.textContent = "划词翻译 · 自动识别 -> 中文";

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
  copyButton.textContent = "复制";
  copyButton.addEventListener("mousedown", (event) => event.preventDefault());
  copyButton.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const copied = await copyText(text);
    copyButton.textContent = copied ? "已复制" : "复制失败";
    window.setTimeout(() => {
      copyButton.textContent = "复制";
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
  typeLabel.textContent = isError ? "划词翻译" : "划词翻译 · 自动识别 -> 中文";

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
  const popover = document.createElement("section");
  popover.id = WORD_POPOVER_ID;
  popover.dataset.pinned = "false";
  popover.innerHTML = '<div class="model-translator-word-loading">正在查词<span class="model-translator-loading-dots" aria-hidden="true"><span></span><span></span><span></span></span></div>';
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
    <div class="model-translator-word-tools"><button type="button" data-word-pin data-tip="临时置顶" title="临时置顶" aria-label="临时置顶"><span class="model-translator-word-tool-icon icon-pin" aria-hidden="true"></span></button><button type="button" data-word-copy data-tip="复制全部" title="复制全部" aria-label="复制全部"><span class="model-translator-word-tool-icon icon-copy" aria-hidden="true"></span></button><button type="button" data-word-favorite class="${entry.favorite ? "is-active" : ""}" title="${entry.favorite ? "移出单词本" : "收藏到单词本"}" aria-label="${entry.favorite ? "移出单词本" : "收藏到单词本"}"><span class="model-translator-word-tool-icon icon-star ${entry.favorite ? "is-filled" : ""}" aria-hidden="true"></span></button><button type="button" data-word-close title="关闭" aria-label="关闭"><span class="model-translator-word-tool-icon icon-close" aria-hidden="true"></span></button></div>
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
    button.title = button.dataset.tip;
    button.setAttribute("aria-label", button.dataset.tip);
    window.setTimeout(() => {
      button.dataset.tip = "复制全部";
      button.title = "复制全部";
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

async function translateVisiblePage(options = {}) {
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
  setFloatingPageTranslationBusy(true);
  if (!options.fromScroll || !pageTranslationRequestId) {
    pageTranslationRequestId = createPageTranslationRequestId();
  }
  const cancelToken = pageTranslationCancelToken;
  let shouldScheduleLazy = false;

  try {
    prunePageTranslationCache();
    await loadPersistentPageTranslationCache();
    const cacheMeta = await getPageCacheMeta();

    const nodes = collectTextNodes().slice(0, PAGE_LIMIT);
    let translatedCount = 0;
    const pending = [];

    for (const node of nodes) {
      if (cancelToken !== pageTranslationCancelToken) return translatedCount;
      const original = node.nodeValue;
      const text = original.trim();
      const cached = getCachedPageTranslation(text) || getPersistentPageTranslation(text, cacheMeta);

      if (cached) {
        applyNodeTranslation(node, original, cached);
        translatedCount += 1;
      } else {
        pending.push({ node, original, text });
      }
    }

    for (let index = 0; index < pending.length; index += PAGE_BATCH_SIZE * PAGE_BATCH_CONCURRENCY) {
      if (cancelToken !== pageTranslationCancelToken) return translatedCount;
      const wave = [];
      for (let offset = 0; offset < PAGE_BATCH_SIZE * PAGE_BATCH_CONCURRENCY; offset += PAGE_BATCH_SIZE) {
        const chunk = pending.slice(index + offset, index + offset + PAGE_BATCH_SIZE);
        if (chunk.length) {
          wave.push(translatePageChunk(chunk, index + offset, cacheMeta, cancelToken));
        }
      }

      const counts = await Promise.all(wave);
      if (cancelToken !== pageTranslationCancelToken) return translatedCount;
      translatedCount += counts.reduce((sum, count) => sum + count, 0);
      await persistPageTranslationCache();
    }

    shouldScheduleLazy = true;
    return translatedCount;
  } finally {
    pageTranslationRunning = false;
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

  const response = await chrome.runtime.sendMessage({
    type: "translate-batch",
    requestId: pageTranslationRequestId,
    items
  });

  if (!response?.ok) throw new Error(response?.error || "整页翻译失败");
  if (cancelToken !== pageTranslationCancelToken) return 0;

  let translatedCount = 0;
  const translations = new Map(response.items.map((item) => [item.id, item.translation]));
  for (let offset = 0; offset < chunk.length; offset += 1) {
    if (cancelToken !== pageTranslationCancelToken) return translatedCount;
    const entry = chunk[offset];
    const translation = translations.get(baseIndex + offset);
    if (!translation) continue;

    setCachedPageTranslation(entry.text, translation);
    setPersistentPageTranslation(entry.text, translation, cacheMeta);
    applyNodeTranslation(entry.node, entry.original, translation);
    translatedCount += 1;
  }
  return translatedCount;
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

function setPageBilingualDisplay(enabled) {
  pageTranslationDisplayMode = enabled ? "bilingual" : "translated";
  if (translatedNodes.length) translatedNodes.forEach(renderPageTranslationEntry);
  updateFloatingPageButton(document.getElementById(FLOATING_HOST_ID)?.shadowRoot?.querySelector(".floating-menu"), { translated: translatedNodes.length > 0 });
  return { translated: translatedNodes.length > 0, bilingual: pageTranslationDisplayMode === "bilingual" };
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

  const parent = entry.node.parentElement;
  const compactTarget = parent?.closest("button, a, summary, [role='button'], [role='link'], [role='menuitem'], nav, header");
  if (compactTarget) {
    entry.node.nodeValue = entry.translation;
    if (!entry.compactTarget) {
      entry.compactTarget = compactTarget;
      entry.originalTitle = compactTarget.getAttribute("title") || "";
    }
    compactTarget.title = entry.original.trim();
    return;
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
  pageTranslationEnabled = false;
  pageTranslationQueued = false;
  pageTranslationCancelToken += 1;
  window.clearTimeout(pageLazyTimer);
  window.clearTimeout(pageHoverTimer);
  stopPageTranslationObserver();
  setFloatingPageTranslationBusy(false);
  if (pageTranslationRequestId) {
    chrome.runtime.sendMessage({
      type: "cancel-page-translation",
      requestId: pageTranslationRequestId
    }).catch(() => {});
  }
  pageTranslationRequestId = "";
  translatedNodes.reverse().forEach((entry) => {
    if (entry.wrapper?.isConnected) entry.wrapper.replaceWith(entry.node);
    if (entry.compactTarget) entry.compactTarget.title = entry.originalTitle || "";
    if (entry.node?.isConnected) entry.node.nodeValue = entry.original;
  });
  translatedNodes = [];
  translatedNodeSet = new WeakSet();
  pageTranslationDisplayMode = "translated";
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
  if (pageMutationObserver || !document.body) return;
  pageMutationObserver = new MutationObserver((mutations) => {
    if (!pageTranslationEnabled) return;
    if (!mutations.some(isRelevantPageMutation)) return;
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
}

function isRelevantPageMutation(mutation) {
  const target = mutation.target;
  if (!(target instanceof Element)) return false;
  if (target.closest(`#${BUTTON_ID}, #${POPOVER_ID}, #${WORD_POPOVER_ID}, #${FLOATING_HOST_ID}`)) return false;
  if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(target.tagName)) return false;
  return true;
}

function setFloatingPageTranslationBusy(isBusy) {
  const host = document.getElementById(FLOATING_HOST_ID);
  const shadow = host?.shadowRoot;
  if (!shadow) return;
  const cluster = shadow.querySelector(".floating-cluster");
  const pageButton = shadow.querySelector('[data-action="page"]');
  cluster?.classList.toggle("is-page-translating", isBusy);
  if (pageButton) {
    pageButton.classList.toggle("is-busy", isBusy);
    pageButton.toggleAttribute("aria-busy", isBusy);
    if (isBusy) {
      pageButton.dataset.tip = "整页翻译中";
    } else {
      updateFloatingPageButton(shadow.querySelector(".floating-menu"), { translated: translatedNodes.length > 0 });
    }
  }
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
  pagePersistentCache[getPageTranslationCacheKey(text, meta)] = {
    translation,
    createdAt: Date.now()
  };
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

async function persistPageTranslationCache() {
  await chrome.storage.local.set({ [PAGE_PERSISTENT_CACHE_KEY]: pagePersistentCache });
}

function getPageTranslationCacheKey(text, meta) {
  return hashText(`${location.href}\n${meta?.model || ""}\n${meta?.targetLanguage || "中文"}\n${text}`);
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
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const text = node.nodeValue.trim();
        const parent = node.parentElement;

        if (!parent || text.length < 2) return NodeFilter.FILTER_REJECT;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION"].includes(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (translatedNodeSet.has(node)) return NodeFilter.FILTER_REJECT;
        if (parent.closest("[data-model-translator-bilingual]")) return NodeFilter.FILTER_REJECT;
        if (parent.closest(`#${BUTTON_ID}, #${POPOVER_ID}, #${WORD_POPOVER_ID}, #${FLOATING_HOST_ID}`)) return NodeFilter.FILTER_REJECT;
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (!isElementVisible(parent)) return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }
  return nodes
    .map((node, order) => ({ node, order, score: getNodeViewportScore(node) }))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map((item) => item.node);
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
  if (isPageChromeElement(element)) score -= 80;
  if (isInteractiveTextElement(element)) score -= 40;

  const style = window.getComputedStyle(element);
  if (style.position === "fixed" || style.position === "sticky") score += 60;

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
    return;
  }

  const active = await isAssistantModeActive();
  if (active) {
    if (!host) initFloatingLauncher();
  } else {
    host?.remove();
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
  if (!chrome?.runtime?.getURL) return;

  const host = document.createElement("div");
  host.id = FLOATING_HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const wrapper = document.createElement("div");
  wrapper.className = "floating-wrapper is-right-side";
  wrapper.innerHTML = `
    <div class="floating-cluster">
      <button class="floating-button" type="button" title="小译" aria-label="小译">
        <img src="${chrome.runtime.getURL("icons/icon-48.png")}" alt="" />
      </button>
      <button class="floating-dismiss-trigger" type="button" title="让小译先退开" aria-label="让小译先退开">×</button>
      <nav class="floating-menu" aria-label="小译快捷功能">
        <div class="tool-button-page-wrap">
          <button class="tool-button tool-button-primary-page" type="button" data-action="page" data-tip="整页翻译"><span class="ui-icon icon-page" aria-hidden="true"></span></button>
          <button class="page-display-dot" type="button" data-action="display" data-tip="显示格式" aria-label="显示格式" aria-expanded="false"></button>
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
    .floating-cluster:has(.floating-menu.is-pinned) .floating-button {
      opacity: 1;
    }

    .floating-button:active,
    .floating-button.is-dragging {
      cursor: grabbing;
      transform: scale(0.98);
    }

    .floating-button img {
      display: block;
      width: 100%;
      height: 100%;
      border-radius: 0;
      pointer-events: none;
      filter: drop-shadow(0 4px 7px rgba(64, 158, 255, 0.24));
      transform: translate(3px, 1px);
    }

    .floating-cluster.is-page-translating .floating-button::after {
      content: "";
      position: absolute;
      top: -3px;
      right: -3px;
      z-index: 8;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(255, 255, 255, 0.96);
      border-top-color: #409eff;
      border-right-color: #409eff;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 4px 10px rgba(64, 158, 255, 0.22);
      animation: floatingButtonSpin 760ms linear infinite;
    }

    .floating-cluster.is-page-translating:hover .floating-button::after,
    .floating-cluster.is-page-translating:focus-within .floating-button::after,
    .floating-cluster.is-page-translating:has(.floating-menu.is-pinned) .floating-button::after {
      display: none;
    }

    .floating-dismiss-trigger {
      position: absolute;
      z-index: 6;
      left: -5px;
      bottom: -16px;
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
      border: 1px solid rgba(226, 232, 240, 0.95);
      border-radius: 9px;
      background: rgba(255, 255, 255, 0.74);
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.1);
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
    .floating-menu.is-pinned {
      --menu-motion-duration: 410ms;
      --menu-motion-curve: cubic-bezier(0.16, 1.42, 0.3, 1);
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, -10px) scale(1);
    }

    .floating-wrapper.is-near-top .floating-cluster:hover .floating-menu,
    .floating-wrapper.is-near-top .floating-cluster:focus-within .floating-menu,
    .floating-wrapper.is-near-top .floating-menu.is-pinned {
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
        transform: translateY(var(--more-shift)) scale(0.62);
      }
      62% {
        opacity: 1;
        transform: translateY(calc(var(--more-shift) * -0.14)) scale(1.1);
      }
      82% {
        transform: translateY(calc(var(--more-shift) * 0.05)) scale(0.97);
      }
      100% {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @keyframes floatingMoreSpringOut {
      0% {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      35% {
        transform: translateY(calc(var(--more-shift) * -0.08)) scale(1.04);
      }
      100% {
        opacity: 0;
        transform: translateY(var(--more-shift)) scale(0.56);
      }
    }

    .page-display-dot {
      position: absolute;
      z-index: 3;
      top: -2px;
      right: -2px;
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
      white-space: nowrap;
    }

    .page-display-dot:hover::after {
      opacity: 1;
      transform: translateY(-50%) translateX(0);
    }

    .floating-wrapper.is-left-side .page-display-dot::after {
      right: auto;
      left: 42px;
      transform: translateY(-50%) translateX(-4px);
    }

    .floating-wrapper.is-left-side .page-display-dot:hover::after {
      transform: translateY(-50%) translateX(0);
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
      border: 1px solid #b3d8ff;
      border-radius: 10px;
      background: #ffffff;
      color: #409eff;
      cursor: pointer;
      box-shadow: none;
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
      min-height: 24px;
      border: 1px solid #d8dee8;
      border-radius: 8px;
      background: #ffffff;
      color: #64748b;
      cursor: pointer;
      padding: 0 8px;
      font-size: 10px;
      font-weight: 650;
      transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease;
    }

    .copy-mini:hover:not(:disabled) {
      border-color: #b3d8ff;
      background: #f4f9ff;
      color: #2563eb;
      transform: translateY(-1px);
    }

    .copy-mini:active:not(:disabled) {
      transform: translateY(0) scale(0.96);
    }

    .result-wrap textarea,
    .floating-learning-result {
      padding-right: 54px;
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

  const button = shadow.querySelector(".floating-button");
  const dismissTrigger = shadow.querySelector(".floating-dismiss-trigger");
  const dismissMenu = shadow.querySelector(".dismiss-menu");
  const menu = shadow.querySelector(".floating-menu");
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
    compactMenuHeight: 0,
    suppressMoreHover: false,
    moreHoverResetTimer: 0
  };

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

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.dragging = true;
    state.moved = false;
    state.startX = state.x;
    state.startY = state.y;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    button.classList.add("is-dragging");
    button.setPointerCapture(event.pointerId);
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
    const insideLauncher = path.includes(button) || path.includes(menu);
    if (!insideDismiss) {
      dismissMenu.hidden = true;
      dismissTrigger.classList.remove("is-open");
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
  });

  button.addEventListener("pointerup", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!state.dragging) return;
    state.dragging = false;
    button.classList.remove("is-dragging");
    clampFloatingState(state);
    applyFloatingPosition(wrapper, panel, state);
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
    clampFloatingState(state);
    applyFloatingPosition(wrapper, panel, state);
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

  menu.addEventListener("click", async (event) => {
    const displayOption = event.target.closest("[data-page-display]");
    if (displayOption) {
      const bilingual = displayOption.dataset.pageDisplay === "bilingual";
      setPageBilingualDisplay(bilingual);
      state.pageDisplayMenuOpen = false;
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
  button.classList.add("is-busy");
  button.setAttribute("aria-busy", "true");
  button.dataset.tip = state.translated || translatedNodes.length > 0 ? "正在恢复" : "整页翻译中";
  setFloatingStatus(status, state.translated ? "正在恢复" : "整页翻译中");

  try {
    if (state.translated || translatedNodes.length > 0) {
      restorePageText();
      state.translated = false;
      setFloatingStatus(status, "已恢复原文");
    } else {
      const count = await translateVisiblePage({ waitForRunning: true });
      const total = translatedNodes.length;
      state.translated = total > 0;
      setFloatingStatus(status, total > 0 ? `已翻译 ${count || total} 段` : "暂时没有找到新的可翻译正文");
    }
    updateFloatingPageButton(menu, state);
  } catch (error) {
    setFloatingStatus(status, error.message || String(error), true);
  } finally {
    button.classList.remove("is-busy");
    button.removeAttribute("aria-busy");
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
    displayDot.classList.toggle("is-bilingual", bilingual);
    displayDot.dataset.tip = "显示格式";
    displayDot.removeAttribute("title");
    displayDot.setAttribute("aria-label", displayDot.dataset.tip);
    displayDot.setAttribute("aria-expanded", String(Boolean(state.pageDisplayMenuOpen)));
    displayMenu.hidden = !state.pageDisplayMenuOpen;
    displayMenu.querySelectorAll("[data-page-display]").forEach((option) => {
      option.classList.toggle("is-selected", (option.dataset.pageDisplay === "bilingual") === bilingual);
    });
  }
  if (button.classList.contains("is-busy")) return;
  button.innerHTML = `<span class="ui-icon ${translated ? "icon-restore" : "icon-page"}" aria-hidden="true"></span>`;
  button.dataset.tip = translated ? "恢复原文" : "整页翻译";
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
      if (!window.confirm("确定清空单词本吗？")) return;
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
      <button class="swap-button" id="floatingSwapLanguages" type="button" title="反转翻译">⇄</button>
      <select id="floatingTargetLanguage" aria-label="目标语言">
        ${SELF_TARGET_LANGUAGES.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}
      </select>
      <button class="primary" id="floatingSelfTranslate" type="button">翻译</button>
    </div>
    <textarea id="floatingSourceText" placeholder="输入要翻译的内容"></textarea>
    <div class="result-wrap">
      <div id="floatingResultText" class="floating-learning-result" role="textbox" aria-readonly="true" data-placeholder="翻译结果"></div>
      <button class="copy-mini" id="floatingCopyResult" type="button">复制</button>
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

  body.querySelector("#floatingSwapLanguages").addEventListener("click", () => {
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

    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "翻译中";
    setFloatingLearningResult(result, "");
    setFloatingStatus(status, "正在翻译");
    try {
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

function getFloatingLearningText(element) {
  return String(element.dataset.translation ?? element.textContent ?? "").trim();
}

function setFloatingLearningResult(element, text, sourceText = "") {
  element.textContent = "";
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
          <option value="selection">划词翻译</option>
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
    body.querySelector("#floatingClearHistory").addEventListener("click", async () => {
      const confirmed = window.confirm("确定清空全部翻译历史吗？");
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
    body.querySelector("#floatingClearUsage")?.addEventListener("click", async () => {
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
  if (mode === "selection") return "划词翻译";
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
    border: 1px solid #b3d8ff;
    border-radius: 8px;
    background: #ffffff;
    color: #409eff;
    box-shadow: 0 8px 22px rgba(64, 158, 255, 0.16);
    cursor: pointer;
    font: 700 15px/32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-align: center;
    transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
  }

  #${BUTTON_ID}:hover {
    border-color: #409eff;
    background: #ecf5ff;
    transform: translateY(-1px) scale(1.03);
    box-shadow: 0 10px 24px rgba(64, 158, 255, 0.24);
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
    align-items: center;
    gap: 8px;
    min-height: 44px;
    color: #409eff;
    font: 650 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
    height: 24px;
    border: 1px solid #d8dee8;
    border-radius: 8px;
    background: #ffffff;
    color: #64748b;
    cursor: pointer;
    padding: 0 8px;
    font: 500 11px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, color 140ms ease;
  }

  #${POPOVER_ID} .model-translator-popover-copy:hover {
    border-color: #b3d8ff;
    background: #f4f9ff;
    color: #2563eb;
    transform: translateY(-1px);
  }

  #${POPOVER_ID} .model-translator-popover-copy:active {
    transform: translateY(0) scale(0.96);
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
    align-items: center;
    justify-content: center;
    min-height: 96px;
    gap: 7px;
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
  #${WORD_POPOVER_ID} .icon-copy { mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='9' y='9' width='10' height='10' rx='1.5' fill='none' stroke='black' stroke-width='2'/%3E%3Cpath d='M15 9V6.5A1.5 1.5 0 0 0 13.5 5h-8A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16H9' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E"); -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='9' y='9' width='10' height='10' rx='1.5' fill='none' stroke='black' stroke-width='2'/%3E%3Cpath d='M15 9V6.5A1.5 1.5 0 0 0 13.5 5h-8A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16H9' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E"); }
  #${WORD_POPOVER_ID} .icon-star { mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.2' stroke-linejoin='round' d='m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.7l6.2-.9L12 3Z'/%3E%3C/svg%3E"); -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.2' stroke-linejoin='round' d='m12 3 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.7l6.2-.9L12 3Z'/%3E%3C/svg%3E"); }
  #${WORD_POPOVER_ID} [data-word-favorite].is-active .icon-star, #${WORD_POPOVER_ID} .icon-star.is-filled { mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='m12 2.8 2.9 5.9 6.5.9-4.7 4.5 1.1 6.4-5.8-3.1-5.8 3.1 1.1-6.4-4.7-4.5 6.5-.9L12 2.8Z'/%3E%3C/svg%3E"); -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='black' d='m12 2.8 2.9 5.9 6.5.9-4.7 4.5 1.1 6.4-5.8-3.1-5.8 3.1 1.1-6.4-4.7-4.5 6.5-.9L12 2.8Z'/%3E%3C/svg%3E"); }
  #${WORD_POPOVER_ID} .icon-close { mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' d='m7 7 10 10m0-10L7 17'/%3E%3C/svg%3E"); -webkit-mask-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='none' stroke='black' stroke-width='2.4' stroke-linecap='round' d='m7 7 10 10m0-10L7 17'/%3E%3C/svg%3E"); }
  #${WORD_POPOVER_ID} .model-translator-word-tool-icon.icon-pin,
  #${WORD_POPOVER_ID} .model-translator-word-tool-icon.icon-copy { mask-size: 15px 15px; -webkit-mask-size: 15px 15px; }
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
