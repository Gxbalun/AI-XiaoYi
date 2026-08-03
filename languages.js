(() => {
  const targetLanguages = [
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
    ["印地文", "印地文"],
    ["泰文", "泰文"],
    ["越南文", "越南文"],
    ["印尼文", "印尼文"],
    ["马来文", "马来文"],
    ["土耳其文", "土耳其文"],
    ["荷兰文", "荷兰文"],
    ["波兰文", "波兰文"],
    ["瑞典文", "瑞典文"],
    ["希腊文", "希腊文"],
    ["希伯来文", "希伯来文"],
    ["乌克兰文", "乌克兰文"]
  ];
  const sourceLanguages = [
    ["自动识别", "自动识别"],
    ...targetLanguages.filter(([value]) => value !== "自动（中英互译）")
  ];

  globalThis.AI_XIAOYI_LANGUAGES = Object.freeze({
    source: Object.freeze(sourceLanguages.map((item) => Object.freeze(item))),
    target: Object.freeze(targetLanguages.map((item) => Object.freeze(item)))
  });
})();
