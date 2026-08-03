const DEFAULT_SETTINGS = {
  baseUrl: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4o-mini",
  targetLanguage: "中文"
};
const CONTENT_VERSION = "1.2.1";
const ASSISTANT_MODE_ENABLED_KEY = "assistantModeEnabled";
const ASSISTANT_MODE_PAUSED_UNTIL_KEY = "assistantModePausedUntil";
const SELECTION_TRANSLATION_ENABLED_KEY = "selectionTranslationEnabled";
const SELECTION_TARGET_LANGUAGE_KEY = "selectionTargetLanguage";
const PAGE_DISPLAY_MODE_KEY = "pageTranslationDisplayMode";
const UI_STATE_DEFAULTS = {
  selfTranslateExpanded: true,
  selfSourceLanguage: "自动识别",
  selfTargetLanguage: "自动（中英互译）",
  [SELECTION_TARGET_LANGUAGE_KEY]: "中文",
  [PAGE_DISPLAY_MODE_KEY]: "translated"
};

const fields = {
  baseUrl: document.getElementById("baseUrl"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model")
};

const statusEl = document.getElementById("status");
const assistantModeToggle = document.getElementById("assistantModeToggle");
const selectionModeToggle = document.getElementById("selectionModeToggle");
const selectionLanguageControl = document.getElementById("selectionLanguageControl");
const selectionTargetLanguageSelect = document.getElementById("selectionTargetLanguage");
const mainView = document.getElementById("mainView");
const historyView = document.getElementById("historyView");
const usageView = document.getElementById("usageView");
const wordBookView = document.getElementById("wordBookView");
const toggleSettingsButton = document.getElementById("toggleSettings");
const settingsBody = document.getElementById("settingsBody");
const settingsSummary = document.getElementById("settingsSummary");
const toggleSelfTranslateButton = document.getElementById("toggleSelfTranslate");
const selfTranslateBody = document.getElementById("selfTranslateBody");
const selfSummary = document.getElementById("selfSummary");
const saveButton = document.getElementById("save");
const translatePageButton = document.getElementById("translatePage");
const pageDisplayControl = document.getElementById("pageDisplayControl");
const pageDisplayTrigger = document.getElementById("pageDisplayTrigger");
const pageDisplayMenu = document.getElementById("pageDisplayMenu");
const showHistoryButton = document.getElementById("showHistory");
const showUsageButton = document.getElementById("showUsage");
const showWordBookButton = document.getElementById("showWordBook");
const clearHistoryButton = document.getElementById("clearHistory");
const historyFilter = document.getElementById("historyFilter");
const historySearch = document.getElementById("historySearch");
const clearUsageButton = document.getElementById("clearUsage");
const sourceLanguageSelect = document.getElementById("sourceLanguage");
const targetLanguageSelect = document.getElementById("targetLanguage");
const swapLanguagesButton = document.getElementById("swapLanguages");
const selfSourceText = document.getElementById("selfSourceText");
const selfResultText = document.getElementById("selfResultText");
const selfTranslateButton = document.getElementById("selfTranslate");
const copySelfResultButton = document.getElementById("copySelfResult");
const historyContent = document.getElementById("historyContent");
const usageContent = document.getElementById("usageContent");
const wordBookSearch = document.getElementById("wordBookSearch");
const wordBookSortControl = document.getElementById("wordBookSortControl");
const wordBookSortTrigger = document.getElementById("wordBookSortTrigger");
const wordBookSortMenu = document.getElementById("wordBookSortMenu");
const wordBookContent = document.getElementById("wordBookContent");
const clearWordBookButton = document.getElementById("clearWordBook");
const wordStudyDialog = document.getElementById("wordStudyDialog");
let currentHistory = [];
let currentWordBook = [];
let wordStudyPinned = false;
let wordBookSort = "saved-desc";
let pageTranslationState = { translated: false, bilingual: false };

document.addEventListener("DOMContentLoaded", init);
assistantModeToggle.addEventListener("click", toggleAssistantMode);
selectionModeToggle.addEventListener("click", toggleSelectionMode);
selectionTargetLanguageSelect.addEventListener("change", async () => {
  await setSelectionTargetLanguage(selectionTargetLanguageSelect.value, true);
  showStatus(`随手划将翻译为${getLanguageDisplayLabel(selectionTargetLanguageSelect.value)}`);
});
toggleSettingsButton.addEventListener("click", toggleSettings);
toggleSelfTranslateButton.addEventListener("click", toggleSelfTranslate);
saveButton.addEventListener("click", saveSettings);
translatePageButton.addEventListener("click", translatePage);
pageDisplayTrigger.addEventListener("click", () => {
  pageDisplayMenu.hidden = !pageDisplayMenu.hidden;
  pageDisplayTrigger.setAttribute("aria-expanded", String(!pageDisplayMenu.hidden));
});
pageDisplayMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-page-display]");
  if (!option) return;
  setPageDisplayMode(option.dataset.pageDisplay);
});
showHistoryButton.addEventListener("click", showHistory);
showUsageButton.addEventListener("click", showUsage);
showWordBookButton.addEventListener("click", showWordBook);
clearHistoryButton.addEventListener("click", clearHistory);
historyFilter.addEventListener("change", () => renderHistory(currentHistory));
historySearch.addEventListener("input", () => renderHistory(currentHistory));
clearUsageButton.addEventListener("click", clearUsage);
clearWordBookButton.addEventListener("click", clearWordBook);
wordBookSearch.addEventListener("input", renderWordBook);
wordBookSortTrigger.addEventListener("click", () => {
  wordBookSortMenu.hidden = !wordBookSortMenu.hidden;
  wordBookSortTrigger.setAttribute("aria-expanded", String(!wordBookSortMenu.hidden));
});
wordBookSortMenu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-sort-kind]");
  if (!button) return;
  const kind = button.dataset.sortKind;
  const [currentKind, currentDirection] = wordBookSort.split("-");
  wordBookSort = currentKind === kind
    ? `${kind}-${currentDirection === "asc" ? "desc" : "asc"}`
    : `${kind}-${kind === "saved" ? "desc" : "asc"}`;
  wordBookSortMenu.hidden = true;
  wordBookSortTrigger.setAttribute("aria-expanded", "false");
  updateWordBookSortUi();
  renderWordBook();
});
document.addEventListener("pointerdown", (event) => {
  if (!wordBookSortControl.contains(event.target)) {
    wordBookSortMenu.hidden = true;
    wordBookSortTrigger.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!pageDisplayControl.contains(event.target)) {
    closePageDisplayMenu();
  }
});
swapLanguagesButton.addEventListener("click", () => {
  animateSwapButton(swapLanguagesButton);
  swapLanguages();
});
selfTranslateButton.addEventListener("click", translateSelfText);
copySelfResultButton.addEventListener("click", copySelfResult);
targetLanguageSelect.addEventListener("change", saveSelfTranslateState);
sourceLanguageSelect.addEventListener("change", () => {
  sourceLanguageSelect.dataset.autoDetected = sourceLanguageSelect.value === "自动识别" ? "true" : "false";
  saveSelfTranslateState();
});
selfSourceText.addEventListener("input", autoDetectSelfSourceLanguage);
selfSourceText.addEventListener("keydown", (event) => {
  if (
    event.key !== "Enter" ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    event.metaKey
  ) return;
  event.preventDefault();
  if (!selfTranslateButton.disabled) selfTranslateButton.click();
});
document.addEventListener("pointerdown", (event) => {
  if (!wordStudyDialog.hidden && !wordStudyPinned && !wordStudyDialog.contains(event.target) && !event.target.closest(".learn-word")) {
    closeWordStudy();
  }
});
document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => showView("main"));
});
Object.values(fields).forEach((input) => {
  input.addEventListener("input", syncSettingsSummary);
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[SELECTION_TRANSLATION_ENABLED_KEY]) {
    syncSelectionModeButton();
  }
  if (areaName === "local" && changes[SELECTION_TARGET_LANGUAGE_KEY]) {
    setSelectionTargetLanguage(changes[SELECTION_TARGET_LANGUAGE_KEY].newValue, false);
  }
  if (
    areaName === "local" &&
    (changes[ASSISTANT_MODE_ENABLED_KEY] || changes[ASSISTANT_MODE_PAUSED_UNTIL_KEY])
  ) {
    syncAssistantModeButton();
  }
  if (areaName === "local" && changes[PAGE_DISPLAY_MODE_KEY]) {
    updatePageTranslationUi({
      translated: pageTranslationState.translated,
      bilingual: changes[PAGE_DISPLAY_MODE_KEY].newValue === "bilingual"
    });
  }
});

async function init() {
  populateLanguageSelects();
  const settingsResponse = await chrome.runtime.sendMessage({ type: "get-popup-settings" });
  if (!settingsResponse?.ok) throw new Error(settingsResponse?.error || "读取模型配置失败");
  const settings = { ...DEFAULT_SETTINGS, ...settingsResponse.settings };
  const uiState = await chrome.storage.local.get(UI_STATE_DEFAULTS);
  Object.entries(fields).forEach(([key, input]) => {
    input.value = settings[key] ?? DEFAULT_SETTINGS[key];
  });
  setSourceLanguage(uiState.selfSourceLanguage || UI_STATE_DEFAULTS.selfSourceLanguage, true);
  setTargetLanguage(uiState.selfTargetLanguage || UI_STATE_DEFAULTS.selfTargetLanguage);
  await setSelectionTargetLanguage(uiState[SELECTION_TARGET_LANGUAGE_KEY], false);
  pageTranslationState.bilingual = uiState[PAGE_DISPLAY_MODE_KEY] === "bilingual";
  setSelfTranslateExpanded(Boolean(uiState.selfTranslateExpanded), false);
  syncSelfSummary();
  syncSettingsSummary();
  syncAssistantModeButton();
  syncSelectionModeButton();
  setSettingsExpanded(!hasCompleteSettings());
  refreshPageTranslationState();
}

async function toggleAssistantMode() {
  const state = await getAssistantModeState();
  if (state.active) {
    await chrome.storage.local.set({
      [ASSISTANT_MODE_ENABLED_KEY]: false,
      [ASSISTANT_MODE_PAUSED_UNTIL_KEY]: 0
    });
    showStatus("小译先退到后台");
  } else {
    await chrome.storage.local.set({
      [ASSISTANT_MODE_ENABLED_KEY]: true,
      [ASSISTANT_MODE_PAUSED_UNTIL_KEY]: 0
    });
    showStatus("小译回到手边");
  }
  syncAssistantModeButton();
}

async function syncAssistantModeButton() {
  const state = await getAssistantModeState();
  assistantModeToggle.dataset.state = state.active ? "on" : "off";
  assistantModeToggle.textContent = "随身译";
  assistantModeToggle.title = state.active
    ? "小译正安静守在网页边上，需要翻译、记录或设置时，会在手边递上一点帮助。"
    : "需要时点一下，小译会回到网页旁边，陪你处理阅读和翻译。";
}

async function toggleSelectionMode() {
  const stored = await chrome.storage.local.get({ [SELECTION_TRANSLATION_ENABLED_KEY]: true });
  const nextEnabled = stored[SELECTION_TRANSLATION_ENABLED_KEY] === false;
  await chrome.storage.local.set({ [SELECTION_TRANSLATION_ENABLED_KEY]: nextEnabled });
  showStatus(nextEnabled ? "随手划已开启" : "随手划已收起");
  syncSelectionModeButton();
}

async function syncSelectionModeButton() {
  const stored = await chrome.storage.local.get({ [SELECTION_TRANSLATION_ENABLED_KEY]: true });
  const enabled = stored[SELECTION_TRANSLATION_ENABLED_KEY] !== false;
  selectionModeToggle.dataset.state = enabled ? "on" : "off";
  selectionModeToggle.textContent = "随手划";
  selectionModeToggle.title = enabled
    ? "选中文字时，小译会带着放大镜来到旁边。"
    : "需要时点一下，小译会重新响应选中的文字。";
}

async function getAssistantModeState() {
  const stored = await chrome.storage.local.get({
    [ASSISTANT_MODE_ENABLED_KEY]: false,
    [ASSISTANT_MODE_PAUSED_UNTIL_KEY]: 0
  });
  const enabled = stored[ASSISTANT_MODE_ENABLED_KEY] !== false;
  const pausedUntil = Number(stored[ASSISTANT_MODE_PAUSED_UNTIL_KEY] || 0);
  if (pausedUntil && pausedUntil <= Date.now()) {
    await chrome.storage.local.set({ [ASSISTANT_MODE_PAUSED_UNTIL_KEY]: 0 });
    return { enabled, pausedUntil: 0, active: enabled };
  }
  return { enabled, pausedUntil, active: enabled && pausedUntil <= Date.now() };
}

async function saveSettings() {
  const settings = readSettings();
  setBusy(saveButton, true, "测试连接中");
  showStatus("正在测试");

  try {
    await persistSettings(settings);
    const response = await chrome.runtime.sendMessage({
      type: "test-connection",
      settings
    });
    if (!response?.ok) throw new Error(response?.error || "连接失败");
    showStatus("连接成功");
    syncSettingsSummary();
    setSettingsExpanded(false);
  } catch (error) {
    showStatus(error.message || String(error), true);
  } finally {
    setBusy(saveButton, false, "保存设置");
  }
}

async function translatePage() {
  if (pageTranslationState.translated) {
    await restorePage();
    return;
  }

  await persistSettings(readSettings());
  setBusy(translatePageButton, true, "翻译中");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await ensureContentScript(tab);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "page-translate-v2" });
    if (!response?.ok) throw new Error(response?.error || "整页翻译失败");
    showStatus(response.count > 0 ? `已翻译 ${response.count} 段` : "暂时没有找到新的可翻译正文");
    await refreshPageTranslationState(tab);
  } catch (error) {
    showStatus(error.message || String(error), true);
  } finally {
    translatePageButton.disabled = false;
    translatePageButton.removeAttribute("aria-busy");
    updatePageTranslationUi(pageTranslationState);
  }
}

async function persistSettings(settings) {
  const response = await chrome.runtime.sendMessage({
    type: "save-settings",
    settings,
    preserveApiKey: false
  });
  if (!response?.ok) throw new Error(response?.error || "保存设置失败");
}

async function restorePage() {
  setBusy(translatePageButton, true, "恢复中");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await ensureContentScript(tab);
    await chrome.tabs.sendMessage(tab.id, { type: "page-restore-v2" });
    showStatus("已恢复");
    updatePageTranslationUi({ translated: false, bilingual: pageTranslationState.bilingual });
  } catch (error) {
    showStatus(error.message || String(error), true);
  } finally {
    translatePageButton.disabled = false;
    translatePageButton.removeAttribute("aria-busy");
    updatePageTranslationUi(pageTranslationState);
  }
}

async function setPageDisplayMode(mode) {
  closePageDisplayMenu();
  const wantsBilingual = mode === "bilingual";
  if (wantsBilingual === pageTranslationState.bilingual) return;

  await chrome.storage.local.set({ [PAGE_DISPLAY_MODE_KEY]: wantsBilingual ? "bilingual" : "translated" });
  updatePageTranslationUi({ translated: pageTranslationState.translated, bilingual: wantsBilingual });

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await ensureContentScript(tab);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "page-display-mode-v2", mode });
    if (!response?.ok) throw new Error("译文显示设置失败");
    updatePageTranslationUi(response);
    showStatus(response.translated
      ? (response.bilingual ? "已切换为双语显示" : "已切换为仅译文")
      : (response.bilingual ? "整页翻译将以双语显示" : "整页翻译将仅显示译文"));
  } catch (error) {
    showStatus(wantsBilingual ? "已将双语显示设为全局偏好" : "已将仅译文设为全局偏好");
  }
}

async function refreshPageTranslationState(tab = null) {
  try {
    const targetTab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!targetTab?.id) return;
    await ensureContentScript(targetTab);
    const response = await chrome.tabs.sendMessage(targetTab.id, { type: "page-translation-state-v2" });
    if (response?.ok) updatePageTranslationUi(response);
  } catch {
    const stored = await chrome.storage.local.get({ [PAGE_DISPLAY_MODE_KEY]: "translated" });
    updatePageTranslationUi({ translated: false, bilingual: stored[PAGE_DISPLAY_MODE_KEY] === "bilingual" });
  }
}

function updatePageTranslationUi({ translated, bilingual }) {
  pageTranslationState = {
    translated: Boolean(translated),
    bilingual: typeof bilingual === "boolean" ? bilingual : pageTranslationState.bilingual
  };
  setButtonLabel(
    translatePageButton,
    pageTranslationState.translated ? "恢复原文" : "整页翻译",
    pageTranslationState.translated ? "icon-restore" : "icon-page"
  );
  pageDisplayMenu.querySelectorAll("[data-page-display]").forEach((button) => {
    button.classList.toggle("is-selected", (button.dataset.pageDisplay === "bilingual") === pageTranslationState.bilingual);
  });
}

function closePageDisplayMenu() {
  pageDisplayMenu.hidden = true;
  pageDisplayTrigger.setAttribute("aria-expanded", "false");
}

async function translateSelfText() {
  const text = selfSourceText.value.trim();
  if (!text) {
    showStatus("请输入原文", true);
    return;
  }

  const singleWord = getSingleEnglishWord(text);
  let assistantTabId = 0;
  let wordBusyRequestId = "";
  await persistSettings(readSettings());
  setBusy(selfTranslateButton, true, "翻译中");
  setLearningResult(selfResultText, "");

  try {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await ensureContentScript(tab);
      assistantTabId = tab?.id || 0;
    } catch {
      assistantTabId = 0;
    }
    if (singleWord) {
      wordBusyRequestId = `self-word-${Date.now()}`;
      if (assistantTabId) {
        await chrome.tabs.sendMessage(assistantTabId, {
          type: "assistant-translation-busy-v2",
          requestId: wordBusyRequestId,
          busy: true
        }).catch(() => {});
      }
      const response = await chrome.runtime.sendMessage({
        type: "lookup-english-word",
        word: singleWord,
        sentence: ""
      });
      if (!response?.ok) throw new Error(response?.error || "查词失败");
      setInlineWordResult(selfResultText, { ...response.entry, contextMeaning: "" }, showStatus);
      showStatus("单词资料已生成");
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: "translate-self",
      text,
      sourceLanguage: sourceLanguageSelect.value,
      targetLanguage: targetLanguageSelect.value,
      assistantTabId
    });
    if (!response?.ok) throw new Error(response?.error || "翻译失败");
    setLearningResult(selfResultText, response.translation, text);
    showStatus("翻译完成");
  } catch (error) {
    showStatus(error.message || String(error), true);
  } finally {
    if (assistantTabId && wordBusyRequestId) {
      chrome.tabs.sendMessage(assistantTabId, {
        type: "assistant-translation-busy-v2",
        requestId: wordBusyRequestId,
        busy: false
      }).catch(() => {});
    }
    setBusy(selfTranslateButton, false, "翻译");
  }
}

async function copySelfResult() {
  const text = getLearningText(selfResultText);
  if (!text) {
    showStatus("暂无译文", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showStatus("已复制");
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    showStatus(copied ? "已复制" : "复制失败", !copied);
  }
}

function swapLanguages() {
  const sourceLanguage = sourceLanguageSelect.value;
  const targetLanguage = targetLanguageSelect.value;
  setSourceLanguage(targetLanguage === "自动（中英互译）" ? "自动识别" : targetLanguage, false);
  setTargetLanguage(sourceLanguage === "自动识别" ? "自动（中英互译）" : sourceLanguage);
  saveSelfTranslateState();

  if (getLearningText(selfResultText)) {
    const sourceText = selfSourceText.value;
    selfSourceText.value = getLearningText(selfResultText);
    setLearningResult(selfResultText, sourceText);
  }
}

function animateSwapButton(button) {
  button.classList.remove("is-swapping");
  void button.offsetWidth;
  button.classList.add("is-swapping");
  button.addEventListener("animationend", () => button.classList.remove("is-swapping"), { once: true });
}

async function ensureContentScript(tab) {
  if (!tab?.id) {
    throw new Error("没有找到当前标签页。");
  }
  if (!/^https?:\/\//i.test(tab.url || "")) {
    throw new Error("当前页面不支持注入翻译脚本，请在普通网页中使用。");
  }

  let ping;
  try {
    ping = await chrome.tabs.sendMessage(tab.id, { type: "translator-ping" });
  } catch {
    throw new Error("插件刚刚更新过，请刷新当前网页后再试。");
  }
  if (ping?.ok && ping.version === CONTENT_VERSION) return;
  if (!ping?.ok || ping.canDispose !== true) {
    throw new Error("当前网页仍在运行旧版小译，请刷新网页后再试。");
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["languages.js", "content.js"]
  });
  const refreshedPing = await chrome.tabs.sendMessage(tab.id, { type: "translator-ping" });
  if (!refreshedPing?.ok || refreshedPing.version !== CONTENT_VERSION) {
    throw new Error("小译没有完成更新，请刷新当前网页后再试。");
  }
}

async function showHistory() {
  showView("history");
  historyContent.innerHTML = '<div class="empty-state">读取中...</div>';

  try {
    const response = await chrome.runtime.sendMessage({ type: "get-history" });
    if (!response?.ok) throw new Error(response?.error || "读取历史失败");
    currentHistory = response.history || [];
    renderHistory(currentHistory);
  } catch (error) {
    historyContent.innerHTML = `<div class="empty-state">${escapeHtml(error.message || String(error))}</div>`;
  }
}

async function clearHistory() {
  const confirmed = await showConfirmDialog("确定清空全部翻译历史吗？");
  if (!confirmed) return;

  try {
    const response = await chrome.runtime.sendMessage({ type: "clear-history" });
    if (!response?.ok) throw new Error(response?.error || "清空失败");
    currentHistory = [];
    renderHistory(currentHistory);
    showStatus("历史已清空");
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
}

async function showUsage() {
  showView("usage");
  usageContent.innerHTML = '<div class="empty-state">读取中...</div>';

  try {
    const response = await chrome.runtime.sendMessage({ type: "get-token-stats" });
    if (!response?.ok) throw new Error(response?.error || "读取用量失败");
    renderUsage(response.stats);
  } catch (error) {
    usageContent.innerHTML = `<div class="empty-state">${escapeHtml(error.message || String(error))}</div>`;
  }
}

async function showWordBook() {
  showView("wordBook");
  updateWordBookSortUi();
  wordBookContent.innerHTML = '<div class="empty-state">读取中...</div>';
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-word-book" });
    if (!response?.ok) throw new Error(response?.error || "读取单词本失败");
    currentWordBook = response.words || [];
    renderWordBook();
  } catch (error) {
    wordBookContent.innerHTML = `<div class="empty-state">${escapeHtml(error.message || String(error))}</div>`;
  }
}

async function clearWordBook() {
  const confirmed = await showConfirmDialog("确定清空单词本吗？");
  if (!confirmed) return;

  try {
    const response = await chrome.runtime.sendMessage({ type: "clear-word-book" });
    if (!response?.ok) throw new Error(response?.error || "清空失败");
    currentWordBook = [];
    wordBookSearch.value = "";
    renderWordBook();
    showStatus("单词本已清空");
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
}

function renderWordBook() {
  const keyword = wordBookSearch.value.trim().toLowerCase();
  const words = sortWordBookEntries(currentWordBook.filter((item) => !keyword || [item.word, item.lemma, item.partOfSpeech, ...(item.meanings || [])]
    .join(" ").toLowerCase().includes(keyword)), wordBookSort);
  if (!words.length) {
    wordBookContent.innerHTML = `<div class="empty-state">${keyword ? "没有找到匹配的单词" : "单词本还是空的"}</div>`;
    return;
  }
  wordBookContent.innerHTML = words.map((item) => `
    <article class="word-book-item">
      <div class="word-book-item-head">
        <span class="word-book-word">${escapeHtml(item.word || item.lemma)}</span>
        <span class="word-book-meta">${escapeHtml([item.phonetic, item.partOfSpeech].filter(Boolean).join(" · "))}</span>
        <button class="word-book-remove" type="button" data-word-key="${escapeHtml(item.key)}">删除</button>
      </div>
      <div class="word-book-meaning">${escapeHtml((item.meanings || []).join("；") || item.contextMeaning || "暂无释义")}</div>
      <div class="word-book-footer">收藏于 ${escapeHtml(item.savedAt ? formatTime(item.savedAt) : "未知")}</div>
    </article>
  `).join("");
  wordBookContent.querySelectorAll("[data-word-key]").forEach((button) => {
    button.addEventListener("click", async () => {
      const response = await chrome.runtime.sendMessage({ type: "remove-word-book-entry", key: button.dataset.wordKey });
      if (!response?.ok) {
        showStatus(response?.error || "删除失败", true);
        return;
      }
      currentWordBook = currentWordBook.filter((item) => item.key !== button.dataset.wordKey);
      renderWordBook();
    });
  });
  wordBookContent.querySelectorAll(".word-book-item").forEach((item, index) => {
    item.addEventListener("click", (event) => {
      if (event.target.closest("[data-word-key]")) return;
      const entry = words[index];
      if (!entry) return;
      entry.favorite = true;
      wordStudyPinned = false;
      wordStudyDialog.hidden = false;
      renderWordStudy(entry);
    });
  });
}

function updateWordBookSortUi() {
  const [kind, direction] = wordBookSort.split("-");
  const labels = {
    "saved-asc": "排序：收藏时间（旧到新）",
    "saved-desc": "排序：收藏时间（新到旧）",
    "alpha-asc": "排序：英文首字母（A-Z）",
    "alpha-desc": "排序：英文首字母（Z-A）"
  };
  const label = labels[wordBookSort] || labels["saved-desc"];
  wordBookSortTrigger.dataset.tip = label;
  wordBookSortTrigger.title = label;
  wordBookSortMenu.querySelectorAll("[data-sort-kind]").forEach((button) => {
    const selected = button.dataset.sortKind === kind;
    button.classList.toggle("is-active", selected);
    const arrow = button.querySelector(".word-book-sort-direction");
    arrow.textContent = selected ? (direction === "asc" ? "↑" : "↓") : "↕";
  });
}

function sortWordBookEntries(words, sort) {
  return words.slice().sort((a, b) => {
    if (sort === "saved-asc") return Number(a.savedAt || 0) - Number(b.savedAt || 0);
    if (sort === "alpha-asc") return String(a.word || a.lemma || "").localeCompare(String(b.word || b.lemma || ""), "en", { sensitivity: "base" });
    if (sort === "alpha-desc") return String(b.word || b.lemma || "").localeCompare(String(a.word || a.lemma || ""), "en", { sensitivity: "base" });
    return Number(b.savedAt || 0) - Number(a.savedAt || 0);
  });
}

async function clearUsage() {
  const confirmed = await showConfirmDialog("确定清空 Token 统计数据吗？");
  if (!confirmed) return;

  try {
    const response = await chrome.runtime.sendMessage({ type: "clear-token-stats" });
    if (!response?.ok) throw new Error(response?.error || "清空失败");
    renderUsage({
      recent: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      total: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      byMode: {}
    });
    showStatus("统计已清空");
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
}

function showConfirmDialog(message) {
  return new Promise((resolve) => {
    document.querySelector(".xiaoyi-confirm-layer")?.remove();

    const layer = document.createElement("div");
    layer.className = "xiaoyi-confirm-layer";
    layer.innerHTML = `
      <div class="xiaoyi-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="xiaoyiConfirmTitle" aria-describedby="xiaoyiConfirmMessage">
        <div class="xiaoyi-confirm-title" id="xiaoyiConfirmTitle">请确认</div>
        <div class="xiaoyi-confirm-message" id="xiaoyiConfirmMessage">${escapeHtml(message)}</div>
        <div class="xiaoyi-confirm-note">清空后无法恢复</div>
        <div class="xiaoyi-confirm-actions">
          <button class="xiaoyi-confirm-cancel" type="button">取消</button>
          <button class="xiaoyi-confirm-danger" type="button">确认清空</button>
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
    layer.querySelector(".xiaoyi-confirm-cancel").addEventListener("click", () => finish(false));
    layer.querySelector(".xiaoyi-confirm-danger").addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKeyDown, true);
    document.body.appendChild(layer);
    layer.querySelector(".xiaoyi-confirm-cancel").focus();
  });
}

function renderHistory(history) {
  const filter = historyFilter.value || "all";
  const keyword = historySearch.value.trim().toLowerCase();
  const filtered = history.filter((item) => {
    const matchesType = filter === "all" || item.mode === filter;
    if (!matchesType) return false;
    if (!keyword) return true;
    return [
      item.source,
      item.translation,
      item.title,
      item.url,
      item.model,
      getLanguagePair(item),
      getModeLabel(item.mode, item.count)
    ].some((value) => String(value || "").toLowerCase().includes(keyword));
  });

  if (!filtered.length) {
    historyContent.innerHTML = `<div class="empty-state">${keyword ? "没有找到匹配的翻译记录" : "最近 7 天还没有翻译记录"}</div>`;
    return;
  }

  historyContent.innerHTML = filtered
    .map((item) => {
      const mode = getModeLabel(item.mode, item.count);
      const badgeClass = getModeClass(item.mode);
      const time = formatTime(item.createdAt);
      const languagePair = getLanguagePair(item);
      const sourceRaw = item.source || "";
      const translationRaw = item.translation || "";
      const isLong = sourceRaw.length > 120 || translationRaw.length > 160;

      return `
        <article class="history-item" data-expanded="false" tabindex="0">
          <div class="history-top">
            <span class="history-badge ${escapeHtml(badgeClass)}">${escapeHtml(mode)}</span>
            <span class="history-lang">${escapeHtml(languagePair)}</span>
            <span class="history-time">${escapeHtml(time)}</span>
          </div>
          <div class="history-text history-source">${escapeHtml(sourceRaw)}</div>
          <div class="history-text history-translation">${escapeHtml(translationRaw)}</div>
          ${isLong ? '<div class="history-more">点击展开</div>' : ""}
        </article>
      `;
    })
    .join("");
  historyContent.querySelectorAll(".history-item").forEach((item) => {
    item.addEventListener("click", (event) => {
      if (!event.target.closest(".history-top, .history-more")) return;
      toggleHistoryItem(item);
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleHistoryItem(item);
      }
    });
  });
}

function renderUsage(stats) {
  const recent = stats?.recent || {};
  const total = stats?.total || {};
  const byMode = stats?.byMode || {};

  usageContent.innerHTML = `
    <div class="usage-grid">
      ${usageCard("近 7 天", recent.totalTokens)}
      ${usageCard("累计使用", total.totalTokens)}
      ${usageCard("输入 Token", recent.promptTokens)}
      ${usageCard("输出 Token", recent.completionTokens)}
    </div>
    <div class="usage-bars">
      ${renderUsageBars(byMode)}
    </div>
  `;
}

function usageCard(label, value) {
  const display = value === null || value === undefined ? "未提供" : formatNumber(value);
  return `
    <div class="usage-card">
      <div class="usage-label">${escapeHtml(label)}</div>
      <div class="usage-value">${escapeHtml(display)}</div>
    </div>
  `;
}

function renderUsageBars(byMode) {
  const entries = ["selection", "page", "self", "word", "test"]
    .map((mode) => ({
      mode,
      label: getModeLabel(mode),
      total: byMode?.[mode]?.totalTokens || 0
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);

  if (!entries.length) {
    return '<div class="empty-state">还没有可展示的分类统计</div>';
  }

  const max = Math.max(...entries.map((item) => item.total), 1);
  return entries
    .map((item) => {
      const width = Math.max(4, Math.round((item.total / max) * 100));
      return `
        <div class="usage-bar-row">
          <div class="usage-bar-head">
            <span>${escapeHtml(item.label)}</span>
            <span>${escapeHtml(formatNumber(item.total))}</span>
          </div>
          <div class="usage-bar">
            <div class="usage-bar-fill ${escapeHtml(getModeClass(item.mode))}" style="width: ${width}%"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

function setTargetLanguage(language) {
  if (language === "自动识别（中英互译）") language = "自动（中英互译）";
  const exists = Array.from(targetLanguageSelect.options).some((option) => option.value === language);
  targetLanguageSelect.value = exists ? language : "自动（中英互译）";
  syncSelfSummary();
}

function setSourceLanguage(language, autoDetected) {
  const exists = Array.from(sourceLanguageSelect.options).some((option) => option.value === language);
  sourceLanguageSelect.value = exists ? language : "自动识别";
  sourceLanguageSelect.dataset.autoDetected = autoDetected ? "true" : "false";
  syncSelfSummary();
}

function autoDetectSelfSourceLanguage() {
  if (sourceLanguageSelect.dataset.autoDetected !== "true" && sourceLanguageSelect.value !== "自动识别") return;
  const detected = detectLanguageName(selfSourceText.value);
  if (detected) {
    setSourceLanguage(detected, true);
    saveSelfTranslateState();
  } else if (!selfSourceText.value.trim()) {
    setSourceLanguage("自动识别", true);
    saveSelfTranslateState();
  }
}

function getModeLabel(mode, count) {
  if (mode === "page") return `整页翻译${count ? ` · ${count} 段` : ""}`;
  if (mode === "self") return "自助译";
  if (mode === "word") return "单词学习";
  if (mode === "test") return "连接测试";
  return "随手划";
}

function getModeClass(mode) {
  if (mode === "page") return "page";
  if (mode === "self") return "self";
  if (mode === "word") return "word";
  if (mode === "test") return "test";
  return "selection";
}

function getLanguagePair(item) {
  const source = item.sourceLanguage || "自动识别";
  const target = item.targetLanguage || "中文";
  return `${source} → ${target}`;
}

function toggleHistoryItem(item) {
  const expanded = item.dataset.expanded === "true";
  item.dataset.expanded = String(!expanded);
  const more = item.querySelector(".history-more");
  if (more) {
    more.textContent = expanded ? "点击展开" : "点击收起";
  }
}

function readSettings() {
  const settings = Object.fromEntries(
    Object.entries(fields).map(([key, input]) => [key, input.value.trim()])
  );
  return { ...settings, targetLanguage: "中文" };
}

function populateLanguageSelects() {
  const registry = globalThis.AI_XIAOYI_LANGUAGES;
  if (!registry?.source?.length || !registry?.target?.length) {
    throw new Error("语言列表加载失败。");
  }
  populateLanguageSelect(sourceLanguageSelect, registry.source);
  populateLanguageSelect(targetLanguageSelect, registry.target);
  populateLanguageSelect(selectionTargetLanguageSelect, registry.target);
}

async function setSelectionTargetLanguage(language, persist) {
  const languages = globalThis.AI_XIAOYI_LANGUAGES?.target || [];
  const supported = languages.some(([value]) => value === language);
  const nextLanguage = supported ? language : "中文";
  selectionTargetLanguageSelect.value = nextLanguage;
  selectionLanguageControl.dataset.languageLabel = `目标：${getLanguageDisplayLabel(nextLanguage)}`;
  selectionTargetLanguageSelect.setAttribute("aria-label", `随手划目标语言：${getLanguageDisplayLabel(nextLanguage)}`);
  if (persist) {
    await chrome.storage.local.set({ [SELECTION_TARGET_LANGUAGE_KEY]: nextLanguage });
  }
}

function getLanguageDisplayLabel(language) {
  const match = (globalThis.AI_XIAOYI_LANGUAGES?.target || []).find(([value]) => value === language);
  return match?.[1] || language || "中文";
}

function populateLanguageSelect(select, languages) {
  select.replaceChildren(...languages.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
}

function showView(view) {
  mainView.hidden = view !== "main";
  historyView.hidden = view !== "history";
  usageView.hidden = view !== "usage";
  wordBookView.hidden = view !== "wordBook";
}

function toggleSettings() {
  setSettingsExpanded(settingsBody.hidden);
}

function toggleSelfTranslate() {
  setSelfTranslateExpanded(selfTranslateBody.hidden, true);
}

function setSettingsExpanded(expanded) {
  settingsBody.hidden = !expanded;
  toggleSettingsButton.setAttribute("aria-expanded", String(expanded));
}

async function setSelfTranslateExpanded(expanded, persist) {
  selfTranslateBody.hidden = !expanded;
  toggleSelfTranslateButton.setAttribute("aria-expanded", String(expanded));
  syncSelfSummary();
  if (persist) {
    await saveSelfTranslateState();
  }
}

async function saveSelfTranslateState() {
  syncSelfSummary();
  await chrome.storage.local.set({
    selfTranslateExpanded: !selfTranslateBody.hidden,
    selfSourceLanguage: sourceLanguageSelect.value,
    selfTargetLanguage: targetLanguageSelect.value
  });
}

function syncSelfSummary() {
  selfSummary.textContent = `${sourceLanguageSelect.value || "自动识别"} → ${targetLanguageSelect.value || "中文"}`;
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

function syncSettingsSummary() {
  const settings = readSettings();
  if (!hasCompleteSettings()) {
    settingsSummary.textContent = "未配置";
    return;
  }
  settingsSummary.textContent = settings.model || "已配置";
}

function hasCompleteSettings() {
  const settings = readSettings();
  return Boolean(settings.baseUrl && settings.apiKey && settings.model);
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (busy) {
    button.innerHTML = `<span class="button-loading"><span class="button-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span></span>`;
    button.setAttribute("aria-busy", "true");
    return;
  }
  button.removeAttribute("aria-busy");
  setButtonLabel(button, label);
}

function setButtonLabel(button, label, iconClassOverride = "") {
  const iconById = {
    save: "✓",
    translatePage: "☰"
  };
  const iconClassById = {
    save: "icon-check",
    translatePage: "icon-page"
  };
  const icon = iconById[button.id];
  if (!icon) {
    button.textContent = label;
    return;
  }
  const iconClass = iconClassOverride || iconClassById[button.id] || "";
  button.innerHTML = `<span class="with-icon"><span class="ui-icon ${escapeHtml(iconClass)}" aria-hidden="true">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span></span>`;
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.title = message;
  statusEl.dataset.state = isError ? "error" : "";
  statusEl.dataset.visible = "true";
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    statusEl.dataset.visible = "false";
    window.setTimeout(() => {
      if (statusEl.dataset.visible === "false") {
        statusEl.textContent = "";
        statusEl.title = "";
        statusEl.dataset.state = "";
      }
    }, 300);
  }, isError ? 8000 : 2600);
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getLearningText(element) {
  return String(element.dataset.translation ?? element.textContent ?? "").trim();
}

function getSingleEnglishWord(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^["“‘([{<]+/, "")
    .replace(/["”’\)\]}>.,!?;:，。！？；：]+$/, "");
  return /^[A-Za-z]+(?:['’][A-Za-z]+|-[A-Za-z]+)*$/.test(normalized) ? normalized : null;
}

function setLearningResult(element, text, sourceText = "") {
  element.textContent = "";
  element.classList.remove("is-word-result");
  const value = String(text || "");
  element.dataset.translation = value;
  if (!value && !sourceText) return;
  if (sourceText && /[A-Za-z]/.test(sourceText)) {
    const source = document.createElement("div");
    source.className = "learning-source";
    appendLearningWords(source, String(sourceText), String(sourceText));
    element.append(source);
  }
  const translation = document.createElement("div");
  translation.className = "learning-translation";
  appendLearningWords(translation, value, value);
  element.append(translation);
}

function setInlineWordResult(element, entry, reportStatus) {
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
      reportStatus(response?.error || "收藏失败", true);
      return;
    }
    entry.favorite = response.favorite;
    favoriteButton.classList.toggle("is-active", entry.favorite);
    favoriteButton.querySelector(".inline-word-star")?.classList.toggle("is-filled", entry.favorite);
    favoriteButton.dataset.tip = entry.favorite ? "移出单词本" : "收藏到单词本";
    favoriteButton.setAttribute("aria-label", favoriteButton.dataset.tip);
    reportStatus(entry.favorite ? "已加入单词本" : "已移出单词本");
  });
}

function appendLearningWords(container, value, sentence) {
  const fragment = document.createDocumentFragment();
  const pattern = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;
  let index = 0;
  for (const match of value.matchAll(pattern)) {
    fragment.append(value.slice(index, match.index));
    const word = document.createElement("span");
    word.className = "learn-word";
    word.textContent = match[0];
    word.title = "点击查看单词学习资料";
    word.addEventListener("click", () => openWordStudy(match[0], sentence));
    fragment.append(word);
    index = match.index + match[0].length;
  }
  fragment.append(value.slice(index));
  container.append(fragment);
}

async function openWordStudy(word, sentence) {
  wordStudyPinned = false;
  wordStudyDialog.hidden = false;
  wordStudyDialog.innerHTML = '<section class="word-study-card"><div class="word-study-loading">正在查词...</div></section>';
  try {
    const response = await chrome.runtime.sendMessage({ type: "lookup-english-word", word, sentence });
    if (!response?.ok) throw new Error(response?.error || "查词失败");
    renderWordStudy(response.entry);
  } catch (error) {
    wordStudyDialog.innerHTML = `<section class="word-study-card"><div class="word-study-loading">${escapeHtml(error.message || String(error))}</div></section>`;
  }
}

function renderWordStudy(entry) {
  const card = document.createElement("section");
  card.className = "word-study-card";
  card.innerHTML = `
    <div class="word-study-head">
      <div class="word-study-intro"><div class="word-study-drag-handle" data-drag-handle title="拖动窗口" aria-label="拖动窗口"><div class="word-study-language">英语</div></div><div class="word-study-word">${escapeHtml(entry.word)}</div><div class="word-study-phonetic">${escapeHtml(entry.phonetic || "暂无音标")}</div></div>
      <div class="word-study-tools"><button type="button" data-pin data-tip="临时置顶" title="临时置顶" aria-label="临时置顶"><span class="word-study-tool-icon icon-pin" aria-hidden="true"></span></button><button type="button" data-copy data-tip="复制全部" aria-label="复制全部"><span class="word-study-tool-icon icon-copy" aria-hidden="true"></span></button><button type="button" data-favorite class="${entry.favorite ? "is-active" : ""}" title="${entry.favorite ? "移出单词本" : "收藏到单词本"}" aria-label="${entry.favorite ? "移出单词本" : "收藏到单词本"}"><span class="word-study-tool-icon icon-star ${entry.favorite ? "is-filled" : ""}" aria-hidden="true"></span></button><button type="button" data-close title="关闭" aria-label="关闭"><span class="word-study-tool-icon icon-close" aria-hidden="true"></span></button></div>
    </div>
    ${entry.contextMeaning ? `<div class="word-study-section"><div class="word-study-label">当前语境</div><div class="word-study-context">${escapeHtml(entry.contextMeaning)}</div></div>` : ""}
    <div class="word-study-section"><div class="word-study-label">${escapeHtml(formatWordPartOfSpeech(entry.partOfSpeech))}</div><ol class="word-study-meanings">${(entry.meanings || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>暂无释义</li>"}</ol></div>
    ${entry.forms?.length ? `<div class="word-study-section"><div class="word-study-label">词形</div><div class="word-study-forms">${escapeHtml(entry.forms.join(" · "))}</div></div>` : ""}
    ${entry.example ? `<div class="word-study-section"><div class="word-study-label">示例</div><div class="word-study-example">${escapeHtml(entry.example)}${entry.exampleTranslation ? `<br>${escapeHtml(entry.exampleTranslation)}` : ""}</div></div>` : ""}
  `;
  wordStudyDialog.replaceChildren(card);
  enableWordStudyDrag(card, card.querySelector("[data-drag-handle]"));
  card.querySelector("[data-close]").addEventListener("click", closeWordStudy);
  card.querySelector("[data-copy]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const copied = await copyText(formatWordDetailsForCopy(entry));
    button.dataset.tip = copied ? "已复制" : "复制失败";
    button.setAttribute("aria-label", button.dataset.tip);
    window.setTimeout(() => {
      button.dataset.tip = "复制全部";
      button.setAttribute("aria-label", "复制全部");
    }, 1200);
  });
  card.querySelector("[data-pin]").addEventListener("click", (event) => {
    wordStudyPinned = !wordStudyPinned;
    event.currentTarget.classList.toggle("is-active", wordStudyPinned);
    event.currentTarget.title = wordStudyPinned ? "取消置顶" : "临时置顶";
    event.currentTarget.setAttribute("aria-label", wordStudyPinned ? "取消置顶" : "临时置顶");
    event.currentTarget.dataset.tip = event.currentTarget.title;
  });
  card.querySelector("[data-favorite]").addEventListener("click", async (event) => {
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
      showStatus(response?.error || "收藏失败", true);
      return;
    }
    entry.favorite = response.favorite;
    button.classList.toggle("is-active", entry.favorite);
    icon?.classList.toggle("is-filled", entry.favorite);
    button.title = entry.favorite ? "移出单词本" : "收藏到单词本";
    button.setAttribute("aria-label", button.title);
    showStatus(entry.favorite ? "已加入单词本" : "已移出单词本");
  });
}

function enableWordStudyDrag(card, dragHandle) {
  if (!dragHandle) return;
  let dragging = false;
  let startLeft = 0;
  let startTop = 0;
  let pointerX = 0;
  let pointerY = 0;
  dragHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    dragging = true;
    startLeft = rect.left;
    startTop = rect.top;
    pointerX = event.clientX;
    pointerY = event.clientY;
    card.classList.add("is-dragging");
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    card.style.transform = "none";
    dragHandle.setPointerCapture(event.pointerId);
  });
  dragHandle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    event.preventDefault();
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const nextLeft = startLeft + event.clientX - pointerX;
    const nextTop = startTop + event.clientY - pointerY;
    const left = Math.min(Math.max(8, nextLeft), Math.max(8, window.innerWidth - width - 8));
    const top = Math.min(Math.max(8, nextTop), Math.max(8, window.innerHeight - height - 8));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  });
  const finishDrag = () => {
    dragging = false;
    card.classList.remove("is-dragging");
  };
  dragHandle.addEventListener("pointerup", finishDrag);
  dragHandle.addEventListener("lostpointercapture", finishDrag);
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function closeWordStudy() {
  wordStudyDialog.hidden = true;
  wordStudyDialog.textContent = "";
  wordStudyPinned = false;
}

function formatWordPartOfSpeech(value) {
  const source = String(value || "").trim().toLowerCase();
  const names = { noun: "名词", verb: "动词", adjective: "形容词", adverb: "副词", pronoun: "代词", preposition: "介词", conjunction: "连词", interjection: "感叹词" };
  return names[source] || value || "释义";
}
