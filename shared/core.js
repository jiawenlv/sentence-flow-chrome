(() => {
  const DEFAULTS = Object.freeze({
    provider: 'online', online: { baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' },
    ollama: { baseUrl: 'http://localhost:11434', model: '', apiKey: '' },
    targetLanguage: 'zh-CN', readingUnit:'paragraph', scope: 'article', translateFixed: true, cacheFixed: true,
    lazy: true, style: 'soft', timeout: 90
  });
  const LANGUAGES = { 'zh-CN':'简体中文', 'zh-TW':'繁體中文', en:'English', ja:'日本語', ko:'한국어', fr:'Français', de:'Deutsch', es:'Español' };
  function settings(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    return { ...DEFAULTS, ...value, online: { ...DEFAULTS.online, ...value.online }, ollama: { ...DEFAULTS.ollama, ...value.ollama } };
  }
  function errorMessage(reason, fallback = '操作失败，请稍后重试。') {
    const text = reason?.message || (typeof reason === 'string' ? reason : '');
    if (/Extension context invalidated|Receiving end does not exist|message (?:port|channel).*closed|Could not establish connection/iu.test(text)) return '扩展连接已断开，请刷新网页后重试；若仍失败，请在扩展管理中重新加载句流。';
    return text || fallback;
  }
  function normalizeText(text) { return text.normalize('NFC').replace(/\s+/gu, ' ').trim(); }
  function segmentText(text, locale, limit = 1800) {
    let segments;
    if (typeof Intl.Segmenter === 'function') {
      segments = Array.from(new Intl.Segmenter(locale || undefined, { granularity: 'sentence' }).segment(text), s => ({ index: s.index, segment: s.segment }));
    } else {
      segments = Array.from(text.matchAll(/[^.!?。！？\n]+(?:[.!?。！？]+[”’"')\]]*|\n|$)\s*/gu), s => ({ index: s.index, segment: s[0] }));
    }
    // ICU deliberately treats some honorifics as sentence endings. Repair the
    // common unambiguous cases before constructing DOM offsets.
    const merged = [];
    for (const part of segments) {
      const previous = merged.at(-1);
      if (previous && !/\n\s*$/u.test(previous.segment) && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|Rev|Capt|Lt|Gen|Sgt|Mt|St|vs|e\.g|i\.e)\.|\bNo\.(?=\s*$))\s*$/iu.test(previous.segment)) previous.segment += part.segment;
      else merged.push({...part});
    }
    const result = [];
    for (const part of merged) {
      let start = part.index;
      const end = start + part.segment.length;
      while (start < end) {
        let stop = Math.min(end, start + limit);
        if (stop < end) {
          // Never split a UTF-16 surrogate pair. Prefer a natural word boundary.
          if (/[\uD800-\uDBFF]/u.test(text[stop - 1])) stop--;
          const space = text.lastIndexOf(' ', stop);
          if (space > start + limit / 2) stop = space + 1;
        }
        const chunk = text.slice(start, stop);
        const leading = chunk.length - chunk.trimStart().length;
        const trimmed = chunk.trim();
        if (trimmed) result.push({ text: trimmed, start: start + leading, end: start + leading + trimmed.length });
        start = stop;
      }
    }
    return result;
  }
  function paragraphText(text, locale, limit = 6000) {
    const trimmed = text.trim(), start = text.length - text.trimStart().length;
    if (!trimmed) return [];
    if (trimmed.length <= limit) return [{text:trimmed,start,end:start+trimmed.length}];
    // Only exceptional long paragraphs are split, preferably at sentence boundaries.
    const chunks = [];
    for (const part of segmentText(text,locale,limit)) {
      const previous = chunks.at(-1);
      if (previous && part.end - previous.start <= limit) {
        previous.end = part.end; previous.text = text.slice(previous.start,previous.end);
      } else chunks.push({...part});
    }
    return chunks;
  }
  function needsTranslation(text, language) {
    if (!/\p{L}/u.test(text) || /^(?:https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2})/iu.test(text)) return false;
    if (language === 'zh-CN' || language === 'zh-TW') {
      const han = (text.match(/\p{Script=Han}/gu) || []).length;
      const other = (text.match(/(?!\p{Script=Han})\p{L}/gu) || []).length;
      if (han && other <= han) return false;
    }
    return true;
  }
  function endpoint(config) {
    const profile = config[config.provider];
    let url;
    try { url = new URL(profile.baseUrl.trim()); }
    catch { throw new Error('服务地址无效，请在设置中填写完整的 HTTP(S) 地址。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('服务地址须为 HTTP(S) 地址，且不含账号、查询参数或锚点。');
    let path = url.pathname.replace(/\/+$/u, '');
    if (config.provider === 'ollama') {
      if (!path.endsWith('/api/chat')) path += path.endsWith('/api') ? '/chat' : '/api/chat';
    } else if (!path.endsWith('/chat/completions')) path += (path ? '' : '/v1') + '/chat/completions';
    url.pathname = path;
    return url.href;
  }
  function permissionPattern(config) { const url = new URL(endpoint(config)); return `${url.protocol}//${url.hostname}/*`; }
  function validateSettings(value) {
    const config = settings(value);
    if (!['ollama', 'online'].includes(config.provider)) throw new Error('请选择支持的翻译服务。');
    if (!['paragraph','sentence'].includes(config.readingUnit)) throw new Error('阅读单位无效。');
    if (!LANGUAGES[config.targetLanguage]) throw new Error('请选择有效的目标语言。');
    if (!['article', 'page'].includes(config.scope) || !['soft','underline','plain'].includes(config.style)) throw new Error('阅读设置无效。');
    for (const flag of ['translateFixed','cacheFixed','lazy']) if (typeof config[flag] !== 'boolean') throw new Error('阅读设置无效。');
    if (!Number.isFinite(config.timeout) || config.timeout < 15 || config.timeout > 180) throw new Error('超时应在 15–180 秒之间。');
    const profile = config[config.provider];
    if (typeof profile.baseUrl !== 'string' || typeof profile.model !== 'string' || typeof profile.apiKey !== 'string') throw new Error('模型配置无效。');
    if (!profile.model.trim()) throw new Error('请先填写模型名称。');
    profile.model = profile.model.trim();
    profile.baseUrl = profile.baseUrl.trim();
    profile.apiKey = profile.apiKey.trim();
    if (profile.model.length > 200 || profile.apiKey.length > 4096 || profile.baseUrl.length > 2048) throw new Error('模型配置过长。');
    endpoint(config);
    return config;
  }
  function parseTranslations(content, items) {
    if (typeof content !== 'string') throw new Error('模型未返回可读取的文本，请在设置中检查接口类型和模型名称后测试连接。');
    let text = content.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('模型未返回有效 JSON，请换用支持 JSON 输出的指令模型。'); }
    const rows = Array.isArray(parsed) ? parsed : parsed?.translations;
    if (!Array.isArray(rows)) throw new Error('模型返回缺少 translations 数组，请在设置中换用支持 JSON 输出的指令模型并测试连接。');
    const map = new Map();
    for (const row of rows) {
      if (!row || !Number.isInteger(row.id) || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 10000 || map.has(row.id)) throw new Error('模型返回的句子格式不正确，请重试；若仍失败，请在设置中更换模型并测试连接。');
      const source = items.find(item => item.id === row.id)?.text || '';
      // Reject leaked JSON envelope endings, but preserve punctuation present in the source.
      const envelopeEnd = /["”]\s*[}]\s*[\]]\s*[}]\s*$/u;
      if (envelopeEnd.test(row.text) && !envelopeEnd.test(source)) throw new Error('模型未返回有效 JSON 译文：译文中混入了 JSON 结构，请重试或更换模型。');
      map.set(row.id, row.text.trim());
    }
    if (map.size !== items.length || items.some(item => !map.has(item.id))) throw new Error('模型返回的句子数量或编号不匹配，请重试；若仍失败，请在设置中更换模型并测试连接。');
    return items.map(item => ({ id: item.id, text: map.get(item.id) }));
  }
  function cacheIdentity(config, origin, text, kind = 'article') {
    return JSON.stringify(['sentence-flow-v5', origin, config.targetLanguage, config.provider, endpoint(config), config[config.provider].model, kind, normalizeText(text)]);
  }
  function packItems(items, maxCount = 12, maxChars = 6000) {
    const packs = []; let pack = [], chars = 0;
    for (const item of items) {
      if (pack.length && (pack.length >= maxCount || chars + item.text.length > maxChars)) { packs.push(pack); pack = []; chars = 0; }
      pack.push(item); chars += item.text.length;
    }
    if (pack.length) packs.push(pack);
    return packs;
  }
  globalThis.SentenceFlowCore = { DEFAULTS, LANGUAGES, settings, errorMessage, normalizeText, segmentText, paragraphText, needsTranslation, endpoint, permissionPattern, validateSettings, parseTranslations, cacheIdentity, packItems };
})();
