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
const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_ITEMS = 300;
const MAX_TOKEN_EVENTS = 1000;
const activeRequests = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "translate-text") {
    translateText(message.text, message.mode, sender)
      .then((translation) => sendResponse({ ok: true, translation }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "translate-self") {
    translateSelfText(message, sender)
      .then((translation) => sendResponse({ ok: true, translation }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
    return true;
  }

  if (message?.type === "translate-batch") {
    translateBatch(message.items || [], sender, message.requestId)
      .then((items) => sendResponse({ ok: true, items }))
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

  if (message?.type === "get-settings-meta") {
    getSettings()
      .then((settings) => sendResponse({
        ok: true,
        model: settings.model || "",
        targetLanguage: settings.targetLanguage || "中文"
      }))
      .catch((error) => sendResponse({ ok: false, error: friendlyErrorMessage(error) }));
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

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function translateText(text, mode = "selection", sender) {
  const settings = await getSettings();
  validateSettings(settings);

  const prompt =
    mode === "page"
      ? `Translate the following webpage text into ${settings.targetLanguage}. Keep meaning, names, numbers, and formatting intent. Return only the translation.`
      : `Translate the following selected text into ${settings.targetLanguage}. Return only the translation.`;

  const result = await callChatCompletions(settings, [
    { role: "system", content: prompt },
    { role: "user", content: text }
  ]);

  await recordTokenUsage(result.usage, { mode, model: result.model });
  await addHistoryItem({
    mode,
    source: text,
    translation: result.content,
    url: sender?.tab?.url || "",
    title: sender?.tab?.title || "",
    model: result.model,
    sourceLanguage: "自动识别",
    targetLanguage: settings.targetLanguage
  });

  return result.content;
}

async function translateSelfText(message, sender) {
  const settings = await getSettings();
  validateSettings(settings);

  const text = message.text?.trim();
  const sourceLanguage = message.sourceLanguage?.trim() || "自动识别";
  const targetLanguage = normalizeAutoTargetLanguage(message.targetLanguage?.trim() || "自动（中英互译）");

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

  await recordTokenUsage(result.usage, { mode: "self", model: result.model });
  await addHistoryItem({
    mode: "self",
    source: text,
    translation: result.content,
    url: sender?.tab?.url || "",
    title: sender?.tab?.title || "",
    model: result.model,
    sourceLanguage,
    targetLanguage
  });

  return result.content;
}

function normalizeAutoTargetLanguage(language) {
  return language === "自动识别（中英互译）" ? "自动（中英互译）" : language;
}

async function testConnection(settings) {
  const mergedSettings = { ...DEFAULT_SETTINGS, ...settings, targetLanguage: "中文" };
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
    { maxTokens: 8, allowEmptyContent: true }
  );
  await recordTokenUsage(result.usage, { mode: "test", model: result.model });

  return result.content || "OK";
}

async function translateBatch(items, sender, requestId) {
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
  await recordTokenUsage(result.usage, { mode: "page", model: result.model });

  const parsed = parseJsonArray(result.content);
  const byId = new Map(parsed.map((item) => [String(item.id), item.translation || ""]));
  const translatedItems = payload.map((item) => ({
    id: item.id,
    translation: byId.get(String(item.id)) || item.text
  }));

  await addHistoryItem({
    mode: "page",
    source: payload.map((item) => item.text).join("\n").slice(0, 1200),
    translation: translatedItems.map((item) => item.translation).join("\n").slice(0, 1200),
    url: sender?.tab?.url || "",
    title: sender?.tab?.title || "",
    model: result.model,
    sourceLanguage: "自动识别",
    targetLanguage: settings.targetLanguage,
    count: translatedItems.length
  });

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
  if (options.requestId) {
    addActiveRequest(options.requestId, controller);
  }
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey.trim()}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: Number(settings.temperature) || 0.2,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {})
      })
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("已停止本次整页翻译。");
    }
    throw new Error(`无法连接模型接口：${endpoint}；${error.message || String(error)}`);
  } finally {
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
    throw new Error(`模型接口请求失败（HTTP ${response.status}）：${detail}；请求地址：${endpoint}`);
  }

  const content = extractMessageContent(data);
  if (!content && options.allowEmptyContent) {
    return {
      content: "",
      usage: normalizeUsage(data?.usage),
      model: data?.model || model,
      endpoint
    };
  }

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
  const value = (/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).replace(/\/+$/, "");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Base URL 格式不正确，请填写类似 https://api.deepseek.com 的地址。");
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

function validateSettings(settings) {
  if (!settings.apiKey?.trim()) {
    throw new Error("请先在插件小窗中填写 API Key。");
  }
  if (!settings.baseUrl?.trim()) {
    throw new Error("请先填写模型接口地址。");
  }
  if (!settings.model?.trim()) {
    throw new Error("请先填写模型名称。");
  }
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

async function addHistoryItem(item) {
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

  await chrome.storage.local.set({ [HISTORY_KEY]: next });
}

async function getHistory() {
  const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  const history = pruneHistory(stored[HISTORY_KEY] || []);
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
  return history;
}

async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}

function pruneHistory(history) {
  const cutoff = Date.now() - HISTORY_TTL_MS;
  return history.filter((item) => item.createdAt >= cutoff);
}

async function recordTokenUsage(usage, meta) {
  if (!usage) return;

  const now = Date.now();
  const stored = await chrome.storage.local.get({
    [TOKEN_EVENTS_KEY]: [],
    [TOKEN_TOTALS_KEY]: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    }
  });

  const event = {
    createdAt: now,
    mode: meta.mode,
    model: meta.model,
    ...usage
  };
  const events = [event, ...(stored[TOKEN_EVENTS_KEY] || [])]
    .filter((item) => now - item.createdAt <= HISTORY_TTL_MS)
    .slice(0, MAX_TOKEN_EVENTS);
  const totals = addUsage(stored[TOKEN_TOTALS_KEY], usage);

  await chrome.storage.local.set({
    [TOKEN_EVENTS_KEY]: events,
    [TOKEN_TOTALS_KEY]: totals
  });
}

async function getTokenStats() {
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

  await chrome.storage.local.set({ [TOKEN_EVENTS_KEY]: events });

  return {
    recent,
    total: stored[TOKEN_TOTALS_KEY],
    byMode,
    events
  };
}

async function clearTokenStats() {
  await chrome.storage.local.set({
    [TOKEN_EVENTS_KEY]: [],
    [TOKEN_TOTALS_KEY]: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    }
  });
}

function addUsage(total, usage) {
  return {
    promptTokens: (total?.promptTokens || 0) + (usage?.promptTokens || 0),
    completionTokens: (total?.completionTokens || 0) + (usage?.completionTokens || 0),
    totalTokens: (total?.totalTokens || 0) + (usage?.totalTokens || 0)
  };
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
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const start = withoutFence.indexOf("[");
    const end = withoutFence.lastIndexOf("]");
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error("模型没有返回可解析的整页翻译 JSON。");
  }
}
