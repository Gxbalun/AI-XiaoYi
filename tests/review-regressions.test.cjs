const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");
const languagesSource = fs.readFileSync(path.join(root, "languages.js"), "utf8");
const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
const popupHtmlSource = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const popupSource = fs.readFileSync(path.join(root, "popup.js"), "utf8");
const floatingIdleIconSource = fs.readFileSync(path.join(root, "icons", "assistant-idle-floating.svg"), "utf8");
const translatingIconSource = fs.readFileSync(path.join(root, "icons", "assistant-translating.svg"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

function createStorageArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      if (keys == null) return structuredClone(data);
      if (typeof keys === "string") return Object.hasOwn(data, keys) ? { [keys]: structuredClone(data[keys]) } : {};
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.filter((key) => Object.hasOwn(data, key)).map((key) => [key, structuredClone(data[key])]));
      }
      return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [
        key,
        Object.hasOwn(data, key) ? structuredClone(data[key]) : structuredClone(fallback)
      ]));
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
    async getBytesInUse(keys) {
      const selected = await this.get(keys);
      return Buffer.byteLength(JSON.stringify(selected));
    },
    async setAccessLevel() {}
  };
}

function loadBackground({ sync = {}, local = {}, fetchImpl } = {}) {
  const syncArea = createStorageArea(sync);
  const localArea = createStorageArea(local);
  const context = vm.createContext({
    AbortController,
    URL,
    TextEncoder,
    console: {
      log: console.log,
      error: console.error,
      warn() {}
    },
    fetch: fetchImpl || (async () => {
      throw new Error("fetch not mocked");
    }),
    setTimeout,
    clearTimeout,
    structuredClone,
    chrome: {
      runtime: {
        getURL: (value = "") => `chrome-extension://test/${value}`,
        onMessage: { addListener() {}, removeListener() {} }
      },
      storage: {
        sync: syncArea,
        local: localArea
      },
      tabs: {
        sendMessage: async () => ({ ok: true })
      }
    }
  });
  context.globalThis = context;
  context.importScripts = () => vm.runInContext(languagesSource, context, { filename: "languages.js" });
  const exposed = [
    "getSettings",
    "saveSettings",
    "testConnection",
    "translateText",
    "normalizeChatCompletionsUrl",
    "validateBatchTranslations",
    "getWordCacheKey",
    "fitOrderedValuesToByteBudget",
    "estimateStorageBytes"
  ];
  vm.runInContext(
    `${backgroundSource}\n;globalThis.__test = { ${exposed.join(", ")} };`,
    context,
    { filename: "background.js" }
  );
  return { api: context.__test, syncArea, localArea };
}

function jsonResponse(data, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText || "OK",
    headers: { get: () => null },
    async text() {
      return JSON.stringify(data);
    }
  };
}

test("floating assistant overlays one interactive star without cutting a circular hole", () => {
  const starPath = "M98 28l4 8 8 4-8 4-4 8-4-8-8-4 8-4 4-8z";
  assert.doesNotMatch(contentSource, /floating-assistant-star-cutout|<circle cx="98" cy="40" r="15"/);
  assert.match(contentSource, /icons\/assistant-idle-floating\.svg/);
  assert.doesNotMatch(floatingIdleIconSource, new RegExp(starPath));
  assert.doesNotMatch(translatingIconSource, new RegExp(starPath));
});

test("legacy API key migrates from sync to local storage", async () => {
  const { api, syncArea, localArea } = loadBackground({
    sync: {
      baseUrl: "https://api.example.com/v1/chat/completions",
      apiKey: "legacy-key",
      model: "model-a",
      targetLanguage: "中文"
    }
  });
  const settings = await api.getSettings();
  assert.equal(settings.apiKey, "legacy-key");
  assert.equal(localArea.data.modelApiKey, "legacy-key");
  assert.equal(Object.hasOwn(syncArea.data, "apiKey"), false);
});

test("remote HTTP is rejected while loopback HTTP remains supported", () => {
  const { api } = loadBackground();
  assert.throws(
    () => api.normalizeChatCompletionsUrl("http://api.example.com"),
    /远程模型接口仅允许使用 HTTPS/
  );
  assert.match(
    api.normalizeChatCompletionsUrl("http://127.0.0.1:11434"),
    /^http:\/\/127\.0\.0\.1:11434\/v1\/chat\/completions/
  );
  assert.match(
    api.normalizeChatCompletionsUrl("http://[::1]:11434"),
    /^http:\/\/\[::1\]:11434\/v1\/chat\/completions/
  );
});

test("invalid remote HTTP settings are not persisted", async () => {
  const { api, syncArea } = loadBackground({
    local: { modelApiKey: "saved-key" },
    sync: {
      baseUrl: "https://api.example.com/v1/chat/completions",
      model: "model-a",
      targetLanguage: "中文"
    }
  });
  await assert.rejects(() => api.saveSettings({
    baseUrl: "http://api.example.com",
    apiKey: "saved-key",
    model: "model-b",
    targetLanguage: "中文"
  }), /仅允许使用 HTTPS/);
  assert.equal(syncArea.data.baseUrl, "https://api.example.com/v1/chat/completions");
  assert.equal(syncArea.data.model, "model-a");
});

test("connection test rejects a 200 response without model content", async () => {
  const { api } = loadBackground({
    local: { modelApiKey: "key" },
    sync: {
      baseUrl: "https://api.example.com/v1/chat/completions",
      model: "model-a",
      targetLanguage: "中文"
    },
    fetchImpl: async () => jsonResponse({ status: "ok" })
  });
  await assert.rejects(() => api.testConnection({}), /没有可用的翻译内容/);
});

test("selection translation uses its requested target language", async () => {
  let requestBody;
  const { api } = loadBackground({
    local: { modelApiKey: "key" },
    sync: {
      baseUrl: "https://api.example.com/v1/chat/completions",
      model: "model-a",
      targetLanguage: "中文"
    },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return jsonResponse({ choices: [{ message: { content: "こんにちは" } }] });
    }
  });
  const translation = await api.translateText("Hello", "selection", {}, "日文");
  assert.equal(translation, "こんにちは");
  assert.match(requestBody.messages[0].content, /selected text into 日文/);
  assert.equal(requestBody.messages[1].content, "Hello");
});

test("popup and content script share the persisted selection target language", () => {
  assert.match(popupHtmlSource, /<select id="selectionTargetLanguage"/);
  assert.match(popupSource, /const SELECTION_TARGET_LANGUAGE_KEY = "selectionTargetLanguage"/);
  assert.match(contentSource, /const SELECTION_TARGET_LANGUAGE_KEY = "selectionTargetLanguage"/);
  assert.match(contentSource, /targetLanguage\s*\n\s*\}\);/);
});

test("single English words use dictionary details only for Chinese targets", () => {
  assert.match(contentSource, /targetLanguage === "中文" \|\|\s*targetLanguage === "自动（中英互译）"/);
  assert.match(contentSource, /if \(shouldShowWordDetails\)/);
});

test("batch validation keeps only unique requested non-empty strings", () => {
  const { api } = loadBackground();
  const payload = [
    { id: 1, text: "one" },
    { id: 2, text: "two" },
    { id: 3, text: "three" },
    { id: 4, text: "four" }
  ];
  const result = api.validateBatchTranslations([
    { id: 1, translation: "一" },
    { id: 2, translation: "" },
    { id: 3, translation: { text: "三" } },
    { id: 4, translation: "四" },
    { id: 4, translation: "重复" },
    { id: 99, translation: "越界" }
  ], payload);
  assert.deepEqual(structuredClone(result), [{ id: 1, translation: "一" }]);
});

test("word cache key changes with sentence context", () => {
  const { api } = loadBackground();
  assert.notEqual(
    api.getWordCacheKey("bank", "They sat on the river bank."),
    api.getWordCacheKey("bank", "She works at a bank.")
  );
  assert.equal(
    api.getWordCacheKey("Bank", "  She   works at a bank. "),
    api.getWordCacheKey("bank", "she works at a bank.")
  );
});

test("byte-budget fitter retains the newest prefix within its limit", () => {
  const { api } = loadBackground();
  const values = Array.from({ length: 20 }, (_, index) => ({ id: index, text: "x".repeat(80) }));
  const budget = api.estimateStorageBytes("items", values.slice(0, 5));
  const fitted = api.fitOrderedValuesToByteBudget(values, (items) => items, "items", budget);
  assert.equal(fitted.length, 5);
  assert.deepEqual(structuredClone(fitted), values.slice(0, 5));
});

test("non-critical history failure does not replace a successful translation", async () => {
  const { api, localArea } = loadBackground({
    local: { modelApiKey: "key" },
    sync: {
      baseUrl: "https://api.example.com/v1/chat/completions",
      model: "model-a",
      targetLanguage: "中文"
    },
    fetchImpl: async () => jsonResponse({
      choices: [{ message: { content: "译文" } }],
      model: "model-a"
    })
  });
  const originalSet = localArea.set;
  localArea.set = async (values) => {
    if (Object.hasOwn(values, "translationHistory")) throw new Error("quota exceeded");
    return originalSet.call(localArea, values);
  };
  assert.equal(await api.translateText("source", "selection", {}), "译文");
});

test("production surfaces share the same language registry", () => {
  assert.deepEqual(manifest.content_scripts[0].js, ["languages.js", "content.js"]);
  assert.match(contentSource, /AI_XIAOYI_LANGUAGES\?\.target/);
  assert.match(popupSource, /populateLanguageSelects\(\)/);
  assert.match(backgroundSource, /TARGET_LANGUAGE_VALUES/);
});

test("content lifecycle and DOM ownership guards are present", () => {
  assert.match(contentSource, /attachShadow\(\{ mode: "closed" \}\)/);
  assert.match(contentSource, /__MODEL_TRANSLATOR_CONTENT_DISPOSE__/);
  assert.match(contentSource, /characterData: true/);
  assert.match(contentSource, /entry\.node\.nodeValue === entry\.lastRenderedValue/);
  assert.match(popupSource, /ping\.canDispose !== true/);
  assert.match(contentSource, /shadow\.addEventListener\("pointerdown", handleFloatingPointerDown/);
  assert.match(contentSource, /event\.currentTarget === document && path\.includes\(host\)/);
});

test("memory page cache is partitioned with the persistent cache key", () => {
  assert.match(contentSource, /getCachedPageTranslation\(text, cacheMeta\)/);
  assert.match(contentSource, /setCachedPageTranslation\(entry\.text, translation, cacheMeta\)/);
  assert.match(contentSource, /pageTranslationCache\.get\(key\)/);
});
