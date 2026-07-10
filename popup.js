const DEFAULT_SETTINGS = {
  baseUrl: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4o-mini",
  targetLanguage: "中文"
};
const CONTENT_VERSION = "1.0.32";
const ASSISTANT_MODE_ENABLED_KEY = "assistantModeEnabled";
const ASSISTANT_MODE_PAUSED_UNTIL_KEY = "assistantModePausedUntil";
const UI_STATE_DEFAULTS = {
  selfTranslateExpanded: true,
  selfSourceLanguage: "自动识别",
  selfTargetLanguage: "自动（中英互译）"
};

const fields = {
  baseUrl: document.getElementById("baseUrl"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model")
};

const statusEl = document.getElementById("status");
const assistantModeToggle = document.getElementById("assistantModeToggle");
const mainView = document.getElementById("mainView");
const historyView = document.getElementById("historyView");
const usageView = document.getElementById("usageView");
const toggleSettingsButton = document.getElementById("toggleSettings");
const settingsBody = document.getElementById("settingsBody");
const settingsSummary = document.getElementById("settingsSummary");
const toggleSelfTranslateButton = document.getElementById("toggleSelfTranslate");
const selfTranslateBody = document.getElementById("selfTranslateBody");
const selfSummary = document.getElementById("selfSummary");
const saveButton = document.getElementById("save");
const translatePageButton = document.getElementById("translatePage");
const restorePageButton = document.getElementById("restorePage");
const showHistoryButton = document.getElementById("showHistory");
const showUsageButton = document.getElementById("showUsage");
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
let currentHistory = [];

document.addEventListener("DOMContentLoaded", init);
assistantModeToggle.addEventListener("click", toggleAssistantMode);
toggleSettingsButton.addEventListener("click", toggleSettings);
toggleSelfTranslateButton.addEventListener("click", toggleSelfTranslate);
saveButton.addEventListener("click", saveSettings);
translatePageButton.addEventListener("click", translatePage);
restorePageButton.addEventListener("click", restorePage);
showHistoryButton.addEventListener("click", showHistory);
showUsageButton.addEventListener("click", showUsage);
clearHistoryButton.addEventListener("click", clearHistory);
historyFilter.addEventListener("change", () => renderHistory(currentHistory));
historySearch.addEventListener("input", () => renderHistory(currentHistory));
clearUsageButton.addEventListener("click", clearUsage);
swapLanguagesButton.addEventListener("click", swapLanguages);
selfTranslateButton.addEventListener("click", translateSelfText);
copySelfResultButton.addEventListener("click", copySelfResult);
targetLanguageSelect.addEventListener("change", saveSelfTranslateState);
sourceLanguageSelect.addEventListener("change", () => {
  sourceLanguageSelect.dataset.autoDetected = sourceLanguageSelect.value === "自动识别" ? "true" : "false";
  saveSelfTranslateState();
});
selfSourceText.addEventListener("input", autoDetectSelfSourceLanguage);
document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => showView("main"));
});
Object.values(fields).forEach((input) => {
  input.addEventListener("input", syncSettingsSummary);
});
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes[ASSISTANT_MODE_ENABLED_KEY] || changes[ASSISTANT_MODE_PAUSED_UNTIL_KEY])
  ) {
    syncAssistantModeButton();
  }
});

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const uiState = await chrome.storage.local.get(UI_STATE_DEFAULTS);
  Object.entries(fields).forEach(([key, input]) => {
    input.value = settings[key] ?? DEFAULT_SETTINGS[key];
  });
  setSourceLanguage(uiState.selfSourceLanguage || UI_STATE_DEFAULTS.selfSourceLanguage, true);
  setTargetLanguage(uiState.selfTargetLanguage || UI_STATE_DEFAULTS.selfTargetLanguage);
  setSelfTranslateExpanded(Boolean(uiState.selfTranslateExpanded), false);
  syncSelfSummary();
  syncSettingsSummary();
  syncAssistantModeButton();
  setSettingsExpanded(!hasCompleteSettings());
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
  assistantModeToggle.textContent = "助理模式";
  assistantModeToggle.title = state.active
    ? "小译正安静守在网页边上，需要翻译、记录或设置时，会在手边递上一点帮助。"
    : "需要时点一下，小译会回到网页旁边，陪你处理阅读和翻译。";
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
  await persistSettings(readSettings());
  setBusy(translatePageButton, true, "翻译中");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await ensureContentScript(tab);
    const response = await chrome.tabs.sendMessage(tab.id, { type: "page-translate-v2" });
    if (!response?.ok) throw new Error(response?.error || "整页翻译失败");
    showStatus(response.count > 0 ? `已翻译 ${response.count} 段` : "暂时没有找到新的可翻译正文");
  } catch (error) {
    showStatus(error.message || String(error), true);
  } finally {
    setBusy(translatePageButton, false, "整页翻译");
  }
}

async function persistSettings(settings) {
  await chrome.storage.sync.set(settings);
}

async function restorePage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await ensureContentScript(tab);
    await chrome.tabs.sendMessage(tab.id, { type: "page-restore-v2" });
    showStatus("已恢复");
  } catch (error) {
    showStatus(error.message || String(error), true);
  }
}

async function translateSelfText() {
  const text = selfSourceText.value.trim();
  if (!text) {
    showStatus("请输入原文", true);
    return;
  }

  await persistSettings(readSettings());
  setBusy(selfTranslateButton, true, "翻译中");
  selfResultText.value = "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "translate-self",
      text,
      sourceLanguage: sourceLanguageSelect.value,
      targetLanguage: targetLanguageSelect.value
    });
    if (!response?.ok) throw new Error(response?.error || "翻译失败");
    selfResultText.value = response.translation;
    showStatus("翻译完成");
  } catch (error) {
    showStatus(error.message || String(error), true);
  } finally {
    setBusy(selfTranslateButton, false, "翻译");
  }
}

async function copySelfResult() {
  const text = selfResultText.value.trim();
  if (!text) {
    showStatus("暂无译文", true);
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showStatus("已复制");
  } catch (error) {
    selfResultText.focus();
    selfResultText.select();
    const copied = document.execCommand("copy");
    showStatus(copied ? "已复制" : "复制失败", !copied);
  }
}

function swapLanguages() {
  const sourceLanguage = sourceLanguageSelect.value;
  const targetLanguage = targetLanguageSelect.value;
  setSourceLanguage(targetLanguage === "自动（中英互译）" ? "自动识别" : targetLanguage, false);
  setTargetLanguage(sourceLanguage === "自动识别" ? "自动（中英互译）" : sourceLanguage);
  saveSelfTranslateState();

  if (selfResultText.value.trim()) {
    const sourceText = selfSourceText.value;
    selfSourceText.value = selfResultText.value;
    selfResultText.value = sourceText;
  }
}

async function ensureContentScript(tab) {
  if (!tab?.id) {
    throw new Error("没有找到当前标签页。");
  }
  if (!/^https?:\/\//i.test(tab.url || "")) {
    throw new Error("当前页面不支持注入翻译脚本，请在普通网页中使用。");
  }

  try {
    const ping = await chrome.tabs.sendMessage(tab.id, { type: "translator-ping" });
    if (ping?.ok && ping.version === CONTENT_VERSION) return;
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
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
  const confirmed = window.confirm("确定清空全部翻译历史吗？");
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

async function clearUsage() {
  const confirmed = window.confirm("确定清空 Token 统计数据吗？");
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
  const entries = ["selection", "page", "self", "test"]
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
  if (!exists) {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language;
    targetLanguageSelect.appendChild(option);
  }
  targetLanguageSelect.value = language;
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
  if (mode === "self") return "自助翻译";
  if (mode === "test") return "连接测试";
  return "划词翻译";
}

function getModeClass(mode) {
  if (mode === "page") return "page";
  if (mode === "self") return "self";
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

function showView(view) {
  mainView.hidden = view !== "main";
  historyView.hidden = view !== "history";
  usageView.hidden = view !== "usage";
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

function setButtonLabel(button, label) {
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
  button.innerHTML = `<span class="with-icon"><span class="ui-icon ${escapeHtml(iconClassById[button.id] || "")}" aria-hidden="true">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span></span>`;
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
