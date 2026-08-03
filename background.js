importScripts("languages.js");

const DEFAULT_SETTINGS = {
  baseUrl: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4o-mini",
  targetLanguage: "中文",
  temperature: 0.2
};
const HISTORY_KEY = "translationHistory";
const TOKEN_EVENTS_KEY = "tokenUsageEvents";
const TOKEN_TOTALS_KEY = "tokenUsageTotals";
const WORD_CACHE_KEY = "englishWordCache";
const WORD_BOOK_KEY = "englishWordBook";
const PAGE_PERSISTENT_CACHE_KEY = "pageTranslationPersistentCacheV2";
const LOCAL_API_KEY = "modelApiKey";
const SYNC_SETTING_KEYS = ["baseUrl", "model", "targetLanguage", "temperature"];
const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_ITEMS = 300;
const MAX_TOKEN_EVENTS = 1000;
const WORD_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_WORD_CACHE_ITEMS = 3000;
const MAX_WORD_BOOK_ITEMS = 3000;
const MAX_PAGE_HISTORY_TEXT = 12000;
const PAGE_PERSISTENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_PERSISTENT_CACHE_MAX = 1200;
const MODEL_REQUEST_TIMEOUT_MS = 45000;
const LOCAL_STORAGE_SOFT_LIMIT = 8 * 1024 * 1024;
const HISTORY_BYTE_BUDGET = 2 * 1024 * 1024;
const WORD_CACHE_BYTE_BUDGET = 2 * 1024 * 1024;
const WORD_BOOK_BYTE_BUDGET = 1536 * 1024;
const PAGE_CACHE_BYTE_BUDGET = 2 * 1024 * 1024;
const TOKEN_EVENTS_BYTE_BUDGET = 512 * 1024;
const SOURCE_LANGUAGE_VALUES = new Set(globalThis.AI_XIAOYI_LANGUAGES.source.map(([value]) => value));
const TARGET_LANGUAGE_VALUES = new Set(globalThis.AI_XIAOYI_LANGUAGES.target.map(([value]) => value));
const activeRequests = new Map();
let historyStorageQueue = Promise.resolve();
let tokenStorageQueue = Promise.resolve();
let pageCacheStorageQueue = Promise.resolve();
let boundedStorageQueue = Promise.resolve();
let settingsMigrationPromise = null;

chrome.storage.sync.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })?.catch(() => {});
void migrateSettingsStorage().catch((error) => {
  console.warn("[AI小译] 模型配置迁移暂未完成：", error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "translate-text") {
    translateText(message.text, message.mode, sender, message.targetLanguage)
      .then((translation) => sendResponse({ ok: true, translation }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "translate-self") {
    const assistantTabId = Number(sender?.tab?.id || message.assistantTabId || 0);
    const assistantRequestId = `self-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    notifyAssistantTranslationBusy(assistantTabId, assistantRequestId, true)
      .then(() => translateSelfText(message, sender))
      .then((translation) => sendResponse({ ok: true, translation }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }))
      .finally(() => notifyAssistantTranslationBusy(assistantTabId, assistantRequestId, false));
    return true;
  }

  if (message?.type === "translate-batch") {
    translateBatch(message.items || [], sender, message.requestId, message.batchId)
      .then((items) => sendResponse({ ok: true, items }))
      .catch((error) => sendResponse({
        ok: false,
        error: friendlyErrorMessage(error),
        retryable: Boolean(error?.retryable),
        retryAfterMs: Number(error?.retryAfterMs || 0)
      }));
    return true;
  }

  if (message?.type === "lookup-english-word") {
    lookupEnglishWord(message)
      .then((entry) => sendResponse({ ok: true, entry }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "toggle-word-favorite") {
    toggleWordFavorite(message.entry)
      .then((favorite) => sendResponse({ ok: true, favorite }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "get-word-book") {
    getWordBook()
      .then((words) => sendResponse({ ok: true, words }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "remove-word-book-entry") {
    removeWordBookEntry(message.key)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "clear-word-book") {
    clearWordBook()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "cancel-page-translation") {
    cancelActiveRequest(message.requestId);
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "test-connection") {
    testConnection(message.settings)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "get-popup-settings") {
    if (!isTrustedExtensionPage(sender)) {
      sendResponse({ ok: false, error: "当前页面无权读取完整模型配置。" });
      return;
    }
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "save-settings") {
    saveSettings(message.settings, { preserveApiKey: message.preserveApiKey === true })
      .then((settings) => sendResponse({
        ok: true,
        settings: {
          baseUrl: settings.baseUrl,
          model: settings.model,
          targetLanguage: settings.targetLanguage,
          hasApiKey: Boolean(settings.apiKey)
        }
      }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "get-settings-meta") {
    getSettings()
      .then((settings) => sendResponse({
        ok: true,
        baseUrl: settings.baseUrl || "",
        model: settings.model || "",
        targetLanguage: settings.targetLanguage || "中文",
        hasApiKey: Boolean(settings.apiKey)
      }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "persist-page-translation-cache") {
    persistPageTranslationCacheEntries(message.entries)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "get-history") {
    getHistory()
      .then((history) => sendResponse({ ok: true, history }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "clear-history") {
    clearHistory()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "get-token-stats") {
    getTokenStats()
      .then((stats) => sendResponse({ ok: true, stats }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "clear-token-stats") {
    clearTokenStats()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
});

function notifyAssistantTranslationBusy(tabId, requestId, busy) {
  if (!tabId) return Promise.resolve();
  return chrome.tabs.sendMessage(tabId, {
    type: "assistant-translation-busy-v2",
    requestId,
    busy
  }).catch(() => {});
}

function isTrustedExtensionPage(sender) {
  const extensionRoot = chrome.runtime.getURL("");
  return !sender?.tab && typeof sender?.url === "string" && sender.url.startsWith(extensionRoot);
}

function migrateSettingsStorage() {
  if (settingsMigrationPromise) return settingsMigrationPromise;
  settingsMigrationPromise = (async () => {
    const [synced, local] = await Promise.all([
      chrome.storage.sync.get([...SYNC_SETTING_KEYS, "apiKey"]),
      chrome.storage.local.get(LOCAL_API_KEY)
    ]);
    const hasLocalKey = Object.prototype.hasOwnProperty.call(local, LOCAL_API_KEY) && typeof local[LOCAL_API_KEY] === "string";
    const legacyApiKey = typeof synced.apiKey === "string" ? synced.apiKey.trim() : "";
    if (!hasLocalKey && legacyApiKey) {
      await chrome.storage.local.set({ [LOCAL_API_KEY]: legacyApiKey });
    }
    if (Object.prototype.hasOwnProperty.call(synced, "apiKey")) {
      await chrome.storage.sync.remove("apiKey");
    }
  })().catch((error) => {
    settingsMigrationPromise = null;
    throw error;
  });
  return settingsMigrationPromise;
}

async function getSettings() {
  await migrateSettingsStorage();
  const [synced, local] = await Promise.all([
    chrome.storage.sync.get(SYNC_SETTING_KEYS),
    chrome.storage.local.get({ [LOCAL_API_KEY]: "" })
  ]);
  return {
    ...DEFAULT_SETTINGS,
    ...synced,
    apiKey: typeof local[LOCAL_API_KEY] === "string" ? local[LOCAL_API_KEY] : ""
  };
}

async function saveSettings(settings, options = {}) {
  const current = await getSettings();
  const incomingApiKey = typeof settings?.apiKey === "string" ? settings.apiKey.trim() : "";
  const next = {
    ...DEFAULT_SETTINGS,
    ...current,
    ...settings,
    apiKey: options.preserveApiKey && !incomingApiKey ? current.apiKey : incomingApiKey
  };
  validateSettings(next);
  await chrome.storage.local.set({ [LOCAL_API_KEY]: next.apiKey });
  await chrome.storage.sync.set(Object.fromEntries(SYNC_SETTING_KEYS.map((key) => [key, next[key]])));
  await chrome.storage.sync.remove("apiKey");
  return next;
}

async function translateText(text, mode = "selection", sender, requestedTargetLanguage = "") {
  const settings = await getSettings();
  validateSettings(settings);

  const targetLanguage = mode === "selection"
    ? normalizeAutoTargetLanguage(String(requestedTargetLanguage || settings.targetLanguage || "中文").trim())
    : settings.targetLanguage;
  validateLanguage(targetLanguage, TARGET_LANGUAGE_VALUES, "目标语言");

  const selectionInstruction = targetLanguage === "自动（中英互译）"
    ? "If the selected text is primarily Chinese, translate it into English. If it is primarily English, translate it into Chinese. For mixed text, choose the most useful Chinese-English direction. Return only the translation."
    : `Translate the following selected text into ${targetLanguage}. Return only the translation.`;

  const prompt =
    mode === "page"
      ? `Translate the following webpage text into ${settings.targetLanguage}. Keep meaning, names, numbers, and formatting intent. Return only the translation.`
      : selectionInstruction;

  const result = await callChatCompletions(settings, [
    { role: "system", content: prompt },
    { role: "user", content: text }
  ]);

  await runNonCriticalStorageTasks(
    ["Token 用量", () => recordTokenUsage(result.usage, { mode, model: result.model })],
    ["翻译历史", () => addHistoryItem({
      mode,
      source: text,
      translation: result.content,
      url: sender?.tab?.url || "",
      title: sender?.tab?.title || "",
      model: result.model,
      sourceLanguage: "自动识别",
      targetLanguage
    })]
  );

  return result.content;
}

async function translateSelfText(message, sender) {
  const settings = await getSettings();
  validateSettings(settings);

  const text = message.text?.trim();
  const sourceLanguage = String(message.sourceLanguage || "").trim();
  const targetLanguage = normalizeAutoTargetLanguage(String(message.targetLanguage || "").trim());
  validateLanguage(sourceLanguage, SOURCE_LANGUAGE_VALUES, "原语言");
  validateLanguage(targetLanguage, TARGET_LANGUAGE_VALUES, "目标语言");

  if (!text) {
    throw new Error("请输入要翻译的内容。");
  }

  const sourceInstruction =
    sourceLanguage === "自动识别"
      ? "Detect the source language automatically."
      : `The source language is ${sourceLanguage}.`;

  const targetInstruction =
    targetLanguage === "自动（中英互译）"
      ? "If the user's text is primarily Chinese, translate it into English. If it is primarily English, translate it into Chinese. For mixed text, choose the most useful Chinese-English direction. Return only the translation."
      : `Translate the user's text into ${targetLanguage}. Return only the translation.`;

  const result = await callChatCompletions(settings, [
    {
      role: "system",
      content:
        `${sourceInstruction} ${targetInstruction} ` +
        "Keep names, numbers, formatting intent, and tone."
    },
    { role: "user", content: text }
  ]);

  await runNonCriticalStorageTasks(
    ["Token 用量", () => recordTokenUsage(result.usage, { mode: "self", model: result.model })],
    ["翻译历史", () => addHistoryItem({
      mode: "self",
      source: text,
      translation: result.content,
      url: sender?.tab?.url || "",
      title: sender?.tab?.title || "",
      model: result.model,
      sourceLanguage,
      targetLanguage
    })]
  );

  return result.content;
}

async function lookupEnglishWord(message) {
  const word = String(message.word || "").trim();
  const sentence = String(message.sentence || "").trim().slice(0, 700);
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(word)) {
    throw new Error("请选择一个英文单词。");
  }

  const key = normalizeWordKey(word);
  const cacheKey = getWordCacheKey(key, sentence);
  const stored = await chrome.storage.local.get({ [WORD_CACHE_KEY]: {}, [WORD_BOOK_KEY]: [] });
  const cache = stored[WORD_CACHE_KEY] || {};
  const legacyCached = cache[key];
  const cached = cache[cacheKey] || (
    legacyCached && normalizeWordContext(legacyCached.context) === normalizeWordContext(sentence)
      ? legacyCached
      : null
  );
  const wordBook = stored[WORD_BOOK_KEY] || [];
  if (cached && Date.now() - Number(cached.updatedAt || 0) <= WORD_CACHE_TTL_MS) {
    return { ...cached, favorite: isWordFavorite(wordBook, cached, key) };
  }

  const settings = await getSettings();
  validateSettings(settings);
  const result = await callWordDictionary(settings, word, sentence);
  await runNonCriticalStorageTasks(
    ["Token 用量", () => recordTokenUsage(result.usage, { mode: "word", model: result.model })]
  );

  const parsed = parseWordJson(result.content);
  if (!parsed) {
    throw new Error("模型没有给出单词资料。它返回了思考草稿而不是最终结果，请重试一次；若持续出现，请换用不输出思考过程的模型。");
  }
  const entry = normalizeWordEntry(parsed, word, sentence);
  const nextCache = pruneWordCache(cache);
  nextCache[cacheKey] = { ...entry, key, updatedAt: Date.now() };
  await runNonCriticalStorageTasks(
    ["单词缓存", () => writeBoundedWordCache(nextCache)]
  );
  return { ...nextCache[cacheKey], favorite: isWordFavorite(wordBook, nextCache[cacheKey], key) };
}

async function callWordDictionary(settings, word, sentence) {
  const messages = [
    {
      role: "system",
      content:
        "You are an English learning dictionary. Return the final JSON object immediately. Do not reveal reasoning, planning, or markdown. " +
        "Use this exact schema: {\"word\":\"\",\"lemma\":\"\",\"phonetic\":\"\",\"partOfSpeech\":\"\",\"meanings\":[\"\"],\"forms\":[\"\"],\"example\":\"\",\"exampleTranslation\":\"\",\"contextMeaning\":\"\"}. " +
        "Write Chinese for meanings, forms, and explanations. Provide at most 3 concise meanings, 4 useful forms, and one short example. " +
        "If context is supplied, contextMeaning must explain the meaning in that context."
    },
    { role: "user", content: JSON.stringify({ word, context: sentence }) }
  ];

  try {
    return await callChatCompletions(settings, messages, {
      maxTokens: 1200,
      responseFormat: { type: "json_object" }
    });
  } catch (error) {
    if (!/response_format|json_object|unsupported|not support/i.test(error?.message || "")) throw error;
    return callChatCompletions(settings, messages, { maxTokens: 1200 });
  }
}

function parseWordJson(content) {
  const cleaned = String(content || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const fenced = String(content || "").match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidates = [
    cleaned,
    fenced,
    start >= 0 && end > start ? cleaned.slice(start, end + 1) : ""
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") return JSON.parse(parsed);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Keep trying a more focused JSON candidate before falling back to readable text.
    }
  }
  return null;
}

function normalizeWordEntry(value, word, sentence) {
  const list = (input, limit) => Array.isArray(input)
    ? input.map((item) => String(item || "").trim()).filter(Boolean).slice(0, limit)
    : [];
  const meanings = list(value?.meanings, 3);
  return {
    word: String(value?.word || word).trim() || word,
    lemma: String(value?.lemma || word).trim() || word,
    phonetic: String(value?.phonetic || "").trim(),
    partOfSpeech: String(value?.partOfSpeech || "").trim(),
    meanings: meanings.length ? meanings : ["模型暂未给出释义，请重试一次。"],
    forms: list(value?.forms, 4),
    example: String(value?.example || "").trim(),
    exampleTranslation: String(value?.exampleTranslation || "").trim(),
    contextMeaning: String(value?.contextMeaning || "").trim(),
    context: sentence
  };
}

async function toggleWordFavorite(rawEntry) {
  const key = normalizeWordKey(rawEntry?.lemma || rawEntry?.word || "");
  if (!key) throw new Error("单词资料不完整，暂时无法收藏。");
  const stored = await chrome.storage.local.get({ [WORD_BOOK_KEY]: [] });
  const words = stored[WORD_BOOK_KEY] || [];
  const index = words.findIndex((item) => item.key === key);
  if (index >= 0) {
    words.splice(index, 1);
    await writeBoundedWordBook(words);
    return false;
  }
  const entry = { ...normalizeWordEntry(rawEntry, rawEntry?.word || key, rawEntry?.context || ""), key, savedAt: Date.now() };
  await writeBoundedWordBook([entry, ...words].slice(0, MAX_WORD_BOOK_ITEMS));
  return true;
}

async function getWordBook() {
  const stored = await chrome.storage.local.get({ [WORD_BOOK_KEY]: [] });
  return (stored[WORD_BOOK_KEY] || []).slice().sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0));
}

async function removeWordBookEntry(key) {
  const stored = await chrome.storage.local.get({ [WORD_BOOK_KEY]: [] });
  await writeBoundedWordBook((stored[WORD_BOOK_KEY] || []).filter((item) => item.key !== key));
}

async function clearWordBook() {
  await chrome.storage.local.set({ [WORD_BOOK_KEY]: [] });
}

function normalizeWordKey(word) {
  return String(word || "").trim().toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
}

function normalizeWordContext(sentence) {
  return String(sentence || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getWordCacheKey(word, sentence) {
  const context = normalizeWordContext(sentence);
  return `${normalizeWordKey(word)}::${hashStorageKey(context || "no-context")}`;
}

function hashStorageKey(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isWordFavorite(words, entry, fallbackKey) {
  const lemmaKey = normalizeWordKey(entry?.lemma || entry?.word || fallbackKey);
  return words.some((item) => item.key === fallbackKey || item.key === lemmaKey);
}

function pruneWordCache(cache) {
  const cutoff = Date.now() - WORD_CACHE_TTL_MS;
  return Object.fromEntries(Object.entries(cache).filter(([, item]) => Number(item?.updatedAt || 0) >= cutoff));
}

function trimWordCache(cache) {
  const entries = Object.entries(cache).sort(([, a], [, b]) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));
  return Object.fromEntries(entries.slice(0, MAX_WORD_CACHE_ITEMS));
}

function writeBoundedWordCache(cache) {
  const entries = Object.entries(trimWordCache(cache))
    .sort(([, a], [, b]) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));
  return writeBoundedObject(WORD_CACHE_KEY, entries, WORD_CACHE_BYTE_BUDGET);
}

function writeBoundedWordBook(words) {
  return writeBoundedArray(WORD_BOOK_KEY, words, WORD_BOOK_BYTE_BUDGET);
}

function normalizeAutoTargetLanguage(language) {
  return language === "自动识别（中英互译）" ? "自动（中英互译）" : language;
}

async function testConnection(settings) {
  const storedSettings = await getSettings();
  const mergedSettings = {
    ...storedSettings,
    ...settings,
    apiKey: settings?.apiKey?.trim() || storedSettings.apiKey,
    targetLanguage: "中文"
  };
  validateSettings(mergedSettings);

  const result = await callChatCompletions(
    mergedSettings,
    [
      {
        role: "system",
        content: "You are a connection tester. Reply with exactly: OK"
      },
      { role: "user", content: "Ping" }
    ],
    { maxTokens: 8 }
  );
  await runNonCriticalStorageTasks(
    ["Token 用量", () => recordTokenUsage(result.usage, { mode: "test", model: result.model })]
  );

  return result.content;
}

async function translateBatch(items, sender, requestId, batchId) {
  const settings = await getSettings();
  validateSettings(settings);

  if (!items.length) return [];

  const payload = items.map((item, index) => ({
    id: item.id ?? index,
    text: item.text
  }));

  const result = await callChatCompletions(
    settings,
    [
      {
        role: "system",
        content:
          `Translate each JSON item text into ${settings.targetLanguage}. ` +
          "Return only a valid JSON array. Preserve each id exactly. Use this schema: [{\"id\":0,\"translation\":\"...\"}]."
      },
      { role: "user", content: JSON.stringify(payload) }
    ],
    { requestId }
  );
  const stableBatchId = String(batchId || `${requestId || "page"}:${payload.map((item) => item.id).join(",")}`);
  await runNonCriticalStorageTasks(
    ["Token 用量", () => recordTokenUsage(result.usage, {
      mode: "page",
      model: result.model,
      eventId: `${requestId || "page"}:${stableBatchId}`
    })]
  );

  const parsed = parseJsonArray(result.content);
  const translatedItems = validateBatchTranslations(parsed, payload);

  if (translatedItems.length) {
    const translatedIds = new Set(translatedItems.map((item) => String(item.id)));
    await runNonCriticalStorageTasks(
      ["翻译历史", () => upsertPageHistoryItem({
        mode: "page",
        pageRequestId: String(requestId || ""),
        batchId: stableBatchId,
        source: payload.filter((item) => translatedIds.has(String(item.id))).map((item) => item.text).join("\n"),
        translation: translatedItems.map((item) => item.translation).join("\n"),
        url: sender?.tab?.url || "",
        title: sender?.tab?.title || "",
        model: result.model,
        sourceLanguage: "自动识别",
        targetLanguage: settings.targetLanguage,
        count: translatedItems.length
      })]
    );
  }

  return translatedItems;
}

async function callChatCompletions(settings, messages, options = {}) {
  const model = settings.model?.trim();
  const endpoint = normalizeChatCompletionsUrl(settings.baseUrl);

  if (!model) {
    throw new Error("请先填写模型名称。");
  }

  let response;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, MODEL_REQUEST_TIMEOUT_MS);
  if (options.requestId) {
    addActiveRequest(options.requestId, controller);
  }
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey.trim()}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: Number(settings.temperature) || 0.2,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options.responseFormat ? { response_format: options.responseFormat } : {})
      })
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      if (timedOut) {
        throw createRequestError("模型接口响应超时。", {
          retryable: true,
          code: "timeout"
        });
      }
      throw new Error("已停止本次整页翻译。");
    }
    throw new Error(`无法连接模型接口：${endpoint}；${error.message || String(error)}`);
  } finally {
    clearTimeout(timeoutId);
    if (options.requestId) {
      removeActiveRequest(options.requestId, controller);
    }
  }

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    data = { raw: responseText };
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || data?.raw || response.statusText;
    throw createRequestError(
      `模型接口请求失败（HTTP ${response.status}）：${detail}；请求地址：${endpoint}`,
      {
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after"))
      }
    );
  }

  const content = extractMessageContent(data);
  if (!content) {
    throw new Error(`模型响应里没有可用的翻译内容。响应摘要：${summarizeResponse(data)}`);
  }

  return {
    content: content.trim(),
    usage: normalizeUsage(data?.usage),
    model: data?.model || model,
    endpoint
  };
}

function cancelActiveRequest(requestId) {
  if (!requestId) return;
  const controllers = activeRequests.get(requestId);
  if (!controllers) return;
  controllers.forEach((controller) => controller.abort());
  activeRequests.delete(requestId);
}

function addActiveRequest(requestId, controller) {
  const controllers = activeRequests.get(requestId) || new Set();
  controllers.add(controller);
  activeRequests.set(requestId, controllers);
}

function removeActiveRequest(requestId, controller) {
  const controllers = activeRequests.get(requestId);
  if (!controllers) return;
  controllers.delete(controller);
  if (!controllers.size) activeRequests.delete(requestId);
}

function normalizeUsage(usage) {
  if (!usage) return null;

  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens) || 0;

  if (!promptTokens && !completionTokens && !totalTokens) return null;

  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}

function extractMessageContent(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const candidates = [
    message?.content,
    message?.reasoning_content,
    choice?.text,
    data?.output_text,
    data?.content
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
    if (Array.isArray(candidate)) {
      const text = candidate
        .map((item) => item?.text || item?.content || "")
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text) return text;
    }
  }

  return "";
}

function summarizeResponse(data) {
  const summary = {
    object: data?.object,
    model: data?.model,
    choices: Array.isArray(data?.choices)
      ? data.choices.map((choice) => ({
          finish_reason: choice?.finish_reason,
          message_keys: choice?.message ? Object.keys(choice.message) : [],
          has_text: Boolean(choice?.text)
        }))
      : undefined,
    error: data?.error?.message || data?.message
  };

  return JSON.stringify(summary).slice(0, 500);
}

function normalizeChatCompletionsUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) {
    throw new Error("Base URL 仅支持 HTTPS；本机模型可使用 localhost 的 HTTP 地址。");
  }
  const value = (/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).replace(/\/+$/, "");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Base URL 格式不正确，请填写类似 https://api.deepseek.com 的地址。");
  }
  if (url.username || url.password) {
    throw new Error("Base URL 不能包含用户名或密码。");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("远程模型接口仅允许使用 HTTPS；HTTP 只允许 localhost、127.0.0.1 或 [::1] 本机地址。");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Base URL 仅支持 HTTPS；本机模型可使用 localhost 的 HTTP 地址。");
  }
  const path = url.pathname.replace(/\/+$/, "");

  if (path.endsWith("/chat/completions")) return url.toString();

  if (url.hostname.includes("deepseek.com")) {
    url.pathname = `${path}/chat/completions`.replace(/\/+/g, "/");
    return url.toString();
  }

  if (path.endsWith("/v1")) {
    url.pathname = `${path}/chat/completions`;
    return url.toString();
  }

  url.pathname = `${path}/v1/chat/completions`.replace(/\/+/g, "/");
  return url.toString();
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1";
}

function validateLanguage(language, allowed, label) {
  if (!allowed.has(language)) {
    throw new Error(`${label}“${language || "空值"}”不受支持，请重新选择。`);
  }
}

function validateSettings(settings) {
  if (!settings.apiKey?.trim()) {
    throw new Error("请先在插件小窗中填写 API Key。");
  }
  if (!settings.baseUrl?.trim()) {
    throw new Error("请先填写模型接口地址。");
  }
  normalizeChatCompletionsUrl(settings.baseUrl);
  if (!settings.model?.trim()) {
    throw new Error("请先填写模型名称。");
  }
  validateLanguage(settings.targetLanguage || "中文", TARGET_LANGUAGE_VALUES, "目标语言");
}

function friendlyErrorMessage(error) {
  const raw = error?.message || String(error || "");
  const message = raw.toLowerCase();

  if (/请先|base url|api key|模型名称/.test(raw)) return raw;
  if (/401|unauthorized|invalid api key|authentication|authenticate|api.?key/.test(message)) {
    return "小译没通过接口认证，请检查 API Key 是否正确，或者这个 Key 是否有当前模型权限。";
  }
  if (/403|forbidden|permission|access denied/.test(message)) {
    return "模型接口拒绝了这次请求，请检查账号权限、模型权限或 Base URL 是否匹配。";
  }
  if (/404|not found|model .*not|model_not_found|unknown model/.test(message)) {
    return "没有找到这个接口或模型，请检查 Base URL 和模型名称是否填写正确。";
  }
  if (/429|rate limit|too many requests|quota|insufficient|余额|额度|限流/.test(message)) {
    return "接口额度或频率可能不够了，可以稍等一下再试，或检查模型服务的余额和限流设置。";
  }
  if (/timeout|timed out/.test(message)) {
    return "模型接口响应超时了，可以稍后再试，或换一个更稳定的接口地址。";
  }
  if (/failed to fetch|networkerror|load failed|无法连接|cors|跨域/.test(message)) {
    return "小译暂时连不上模型接口，请检查网络、Base URL，或确认该接口允许浏览器扩展访问。";
  }
  if (/没有可用的翻译内容|empty|usable/.test(raw)) {
    return "模型返回了空内容。可以重试一次，或换一个兼容 OpenAI Chat Completions 格式的模型。";
  }
  if (/http 400|bad request|invalid request/.test(message)) {
    return "模型接口认为请求格式不正确，请检查 Base URL 是否为 Chat Completions 接口，以及模型名称是否匹配。";
  }
  if (/http 5\d\d|server error|bad gateway|service unavailable/.test(message)) {
    return "模型服务暂时不稳定，可以稍后再试。";
  }

  return raw || "请求失败了，请稍后再试。";
}

function createRequestError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 15000));
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.min(timestamp - Date.now(), 15000));
}

function queueHistoryStorage(task) {
  const run = historyStorageQueue.then(task, task);
  historyStorageQueue = run.catch(() => {});
  return run;
}

function queueTokenStorage(task) {
  const run = tokenStorageQueue.then(task, task);
  tokenStorageQueue = run.catch(() => {});
  return run;
}

function queuePageCacheStorage(task) {
  const run = pageCacheStorageQueue.then(task, task);
  pageCacheStorageQueue = run.catch(() => {});
  return run;
}

function persistPageTranslationCacheEntries(entries) {
  return queuePageCacheStorage(async () => {
    const stored = await chrome.storage.local.get({ [PAGE_PERSISTENT_CACHE_KEY]: {} });
    const cache = stored[PAGE_PERSISTENT_CACHE_KEY] || {};
    const now = Date.now();

    Object.keys(cache).forEach((key) => {
      if (now - Number(cache[key]?.createdAt || 0) > PAGE_PERSISTENT_CACHE_TTL_MS) {
        delete cache[key];
      }
    });

    (Array.isArray(entries) ? entries : []).forEach((item) => {
      if (!item || typeof item.key !== "string" || typeof item.translation !== "string") return;
      const createdAt = Number(item.createdAt || now);
      if (now - createdAt > PAGE_PERSISTENT_CACHE_TTL_MS) return;
      if (Number(cache[item.key]?.createdAt || 0) > createdAt) return;
      cache[item.key] = {
        translation: item.translation,
        createdAt
      };
    });

    Object.entries(cache)
      .sort((a, b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0))
      .slice(PAGE_PERSISTENT_CACHE_MAX)
      .forEach(([key]) => delete cache[key]);

    const entriesByNewest = Object.entries(cache)
      .sort(([, a], [, b]) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
    await writeBoundedObject(PAGE_PERSISTENT_CACHE_KEY, entriesByNewest, PAGE_CACHE_BYTE_BUDGET);
  });
}

function addHistoryItem(item) {
  return queueHistoryStorage(async () => {
    const now = Date.now();
    const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
    const next = [
      {
        id: `${now}-${Math.random().toString(36).slice(2)}`,
        createdAt: now,
        ...item
      },
      ...pruneHistory(stored[HISTORY_KEY] || [])
    ].slice(0, MAX_HISTORY_ITEMS);

    await writeBoundedArray(HISTORY_KEY, next, HISTORY_BYTE_BUDGET);
  });
}

function upsertPageHistoryItem(item) {
  if (!item.pageRequestId) return addHistoryItem(item);
  return queueHistoryStorage(async () => {
    const now = Date.now();
    const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
    const history = pruneHistory(stored[HISTORY_KEY] || []);
    const existingIndex = history.findIndex(
      (entry) => entry.mode === "page" && entry.pageRequestId === item.pageRequestId
    );
    const existing = existingIndex >= 0 ? history.splice(existingIndex, 1)[0] : null;
    const completedBatchIds = new Set(existing?.completedBatchIds || []);
    if (completedBatchIds.has(item.batchId)) return;
    completedBatchIds.add(item.batchId);

    const nextItem = {
      ...existing,
      ...item,
      id: existing?.id || `${now}-${Math.random().toString(36).slice(2)}`,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      source: appendHistoryText(existing?.source, item.source),
      translation: appendHistoryText(existing?.translation, item.translation),
      count: Number(existing?.count || 0) + Number(item.count || 0),
      completedBatchIds: Array.from(completedBatchIds).slice(-200)
    };
    const next = [nextItem, ...history].slice(0, MAX_HISTORY_ITEMS);
    await writeBoundedArray(HISTORY_KEY, next, HISTORY_BYTE_BUDGET);
  });
}

function appendHistoryText(current, addition) {
  return [current, addition]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_PAGE_HISTORY_TEXT);
}

function getHistory() {
  return queueHistoryStorage(async () => {
    const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
    const history = pruneHistory(stored[HISTORY_KEY] || []);
    return writeBoundedArray(HISTORY_KEY, history, HISTORY_BYTE_BUDGET);
  });
}

function clearHistory() {
  return queueHistoryStorage(() => chrome.storage.local.set({ [HISTORY_KEY]: [] }));
}

function pruneHistory(history) {
  const cutoff = Date.now() - HISTORY_TTL_MS;
  return history.filter((item) => item.createdAt >= cutoff);
}

function recordTokenUsage(usage, meta) {
  if (!usage) return;
  return queueTokenStorage(async () => {
    const now = Date.now();
    const stored = await chrome.storage.local.get({
      [TOKEN_EVENTS_KEY]: [],
      [TOKEN_TOTALS_KEY]: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      }
    });
    const currentEvents = stored[TOKEN_EVENTS_KEY] || [];
    if (meta.eventId && currentEvents.some((event) => event.id === meta.eventId)) return;

    const event = {
      id: meta.eventId || `${now}-${Math.random().toString(36).slice(2)}`,
      createdAt: now,
      mode: meta.mode,
      model: meta.model,
      ...usage
    };
    const events = [event, ...currentEvents]
      .filter((item) => now - item.createdAt <= HISTORY_TTL_MS)
      .slice(0, MAX_TOKEN_EVENTS);
    const totals = addUsage(stored[TOKEN_TOTALS_KEY], usage);

    await writeBoundedTokenData(events, totals);
  });
}

function getTokenStats() {
  return queueTokenStorage(async () => {
    const now = Date.now();
    const stored = await chrome.storage.local.get({
      [TOKEN_EVENTS_KEY]: [],
      [TOKEN_TOTALS_KEY]: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      }
    });
    const events = (stored[TOKEN_EVENTS_KEY] || []).filter((item) => now - item.createdAt <= HISTORY_TTL_MS);
    const recent = events.reduce(addUsage, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    });
    const byMode = events.reduce((totals, event) => {
      const mode = event.mode || "other";
      totals[mode] = addUsage(totals[mode], event);
      return totals;
    }, {});

    const boundedEvents = await writeBoundedArray(TOKEN_EVENTS_KEY, events, TOKEN_EVENTS_BYTE_BUDGET);

    return {
      recent,
      total: stored[TOKEN_TOTALS_KEY],
      byMode,
      events: boundedEvents
    };
  });
}

function clearTokenStats() {
  return queueTokenStorage(() => chrome.storage.local.set({
      [TOKEN_EVENTS_KEY]: [],
      [TOKEN_TOTALS_KEY]: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
      }
    })
  );
}

function addUsage(total, usage) {
  return {
    promptTokens: (total?.promptTokens || 0) + (usage?.promptTokens || 0),
    completionTokens: (total?.completionTokens || 0) + (usage?.completionTokens || 0),
    totalTokens: (total?.totalTokens || 0) + (usage?.totalTokens || 0)
  };
}

function queueBoundedStorage(task) {
  const run = boundedStorageQueue.then(task, task);
  boundedStorageQueue = run.catch(() => {});
  return run;
}

function writeBoundedArray(key, values, categoryBudget) {
  return queueBoundedStorage(async () => {
    const bounded = await fitArrayToStorageBudget(key, values, categoryBudget);
    await chrome.storage.local.set({ [key]: bounded });
    return bounded;
  });
}

function writeBoundedObject(key, orderedEntries, categoryBudget) {
  return queueBoundedStorage(async () => {
    const maxBytes = await getAvailableStorageBudget(key, categoryBudget);
    const fittedEntries = fitOrderedValuesToByteBudget(
      orderedEntries,
      (entries) => Object.fromEntries(entries),
      key,
      maxBytes
    );
    const bounded = Object.fromEntries(fittedEntries);
    await chrome.storage.local.set({ [key]: bounded });
    return bounded;
  });
}

function writeBoundedTokenData(events, totals) {
  return queueBoundedStorage(async () => {
    const boundedEvents = await fitArrayToStorageBudget(TOKEN_EVENTS_KEY, events, TOKEN_EVENTS_BYTE_BUDGET);
    await chrome.storage.local.set({
      [TOKEN_EVENTS_KEY]: boundedEvents,
      [TOKEN_TOTALS_KEY]: totals
    });
    return boundedEvents;
  });
}

async function fitArrayToStorageBudget(key, values, categoryBudget) {
  const maxBytes = await getAvailableStorageBudget(key, categoryBudget);
  return fitOrderedValuesToByteBudget(values, (items) => items, key, maxBytes);
}

async function getAvailableStorageBudget(key, categoryBudget) {
  if (typeof chrome.storage.local.getBytesInUse !== "function") return categoryBudget;
  try {
    const [totalBytes, currentKeyBytes] = await Promise.all([
      chrome.storage.local.getBytesInUse(null),
      chrome.storage.local.getBytesInUse(key)
    ]);
    const available = LOCAL_STORAGE_SOFT_LIMIT - Math.max(0, totalBytes - currentKeyBytes);
    return Math.max(32 * 1024, Math.min(categoryBudget, available));
  } catch {
    return categoryBudget;
  }
}

function fitOrderedValuesToByteBudget(values, materialize, key, maxBytes) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = materialize(values.slice(0, middle));
    if (estimateStorageBytes(key, candidate) <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return values.slice(0, low);
}

function estimateStorageBytes(key, value) {
  return new TextEncoder().encode(JSON.stringify({ [key]: value })).byteLength;
}

function parseJsonArray(content) {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(withoutFence);
    if (!Array.isArray(parsed)) throw new Error("模型返回的整页翻译结果不是数组。");
    return parsed;
  } catch {
    const start = withoutFence.indexOf("[");
    const end = withoutFence.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(withoutFence.slice(start, end + 1));
      if (!Array.isArray(parsed)) throw new Error("模型返回的整页翻译结果不是数组。");
      return parsed;
    }
    throw new Error("模型没有返回可解析的整页翻译 JSON。");
  }
}

function validateBatchTranslations(parsed, payload) {
  const requestedIds = new Set(payload.map((item) => String(item.id)));
  const translations = new Map();
  const duplicateIds = new Set();

  parsed.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const id = String(item.id);
    if (!requestedIds.has(id) || typeof item.translation !== "string" || !item.translation.trim()) return;
    if (translations.has(id)) {
      duplicateIds.add(id);
      translations.delete(id);
      return;
    }
    if (!duplicateIds.has(id)) translations.set(id, item.translation.trim());
  });

  return payload
    .filter((item) => translations.has(String(item.id)))
    .map((item) => ({ id: item.id, translation: translations.get(String(item.id)) }));
}

async function runNonCriticalStorageTasks(...tasks) {
  const results = await Promise.allSettled(tasks.map(([, task]) => Promise.resolve().then(task)));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(`[AI小译] ${tasks[index][0]}保存失败：`, result.reason);
    }
  });
}
