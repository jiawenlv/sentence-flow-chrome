(() => {
  if (globalThis.__sentenceFlow) return;
  const C = globalThis.SentenceFlowCore;
  const SCRIPT_VERSION = chrome.runtime.getManifest().version;
  const MARK = 'data-sentence-flow';
  const FIXED = 'header,nav,footer,menu,[role="banner"],[role="navigation"],[role="menubar"],[role="menu"],.site-header,.site-footer';
  const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,figcaption,blockquote,dt,dd,td,th,caption,div,section,article,main,body,header,footer,nav,button,[role="heading"],[role="menuitem"],nav a,header a,footer a,menu a,[role="navigation"] a';
  const UNIT = 'label,legend,summary,output,meter,progress,[role="button"],[role="tab"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[role="link"],[role="treeitem"],[role="tooltip"],[role="status"],[role="timer"],[role="separator"]';
  const SKIP = `script,style,noscript,pre,textarea,input,select,option,svg,math,canvas,iframe,kbd,samp,[translate="no"],.notranslate,[hidden],[inert],[aria-hidden="true"],[${MARK}]`;
  const OVERLAY = 'dialog[open],[role="dialog"],[role="alertdialog"],[popover]:popover-open';
  const records = new Map();
  const dynamicRoots = new Set();
  const dirtyRoots = new Set(), dirtyOwners = new Set();
  let prefs, session, phase = 'idle', paused = false, busy = 0, all = false, ignoreCache = false, error = '', scanTimer, observer, visibilityObserver;
  let nextId = 0, cacheHits = 0, requests = 0, translated = 0, route = location.href, generation = 0;
  const send = async message => {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (!response?.ok) throw new Error(response?.error || '扩展连接已断开，请刷新页面。');
      return response;
    } catch (reason) { throw new Error(C.errorMessage(reason)); }
  };
  function status() {
    const sentences = [...records.values()].flatMap(record => record.sentences);
    const completed = sentences.filter(item => item.state === 'done');
    return { version:SCRIPT_VERSION, active:!!session, phase, paused, total:sentences.length, translated:completed.length, cacheHits:completed.filter(item => item.cached).length, requests, pending:sentences.filter(item => item.state === 'pending').length, error, targetLanguage:prefs?.targetLanguage || 'zh-CN', lazy:prefs?.lazy ?? true };
  }
  let notice, noticeKey = '', dismissedNotice = '';
  function removeNotice() { notice?.remove(); notice = null; noticeKey = ''; }
  function showNotice(text, failed = true) {
    const key = `${failed}:${text}`;
    if (key === dismissedNotice || (key === noticeKey && notice?.isConnected)) return;
    removeNotice(); noticeKey = key;
    const host = document.createElement('div');
    host.setAttribute(MARK,'notice'); host.setAttribute('translate','no');
    for (const [property,value] of Object.entries({all:'initial',position:'fixed',right:'16px',bottom:'16px',width:'360px','max-width':'calc(100vw - 32px)','z-index':'2147483647'})) host.style.setProperty(property,value,'important');
    const root = host.attachShadow({mode:'open'});
    const style = document.createElement('style');
    style.textContent = `:host{color-scheme:light}section{box-sizing:border-box;background:#fff;color:#273329;border:1px solid #d9dfd6;border-radius:12px;padding:18px;box-shadow:0 6px 28px #0003;font:14px/1.6 system-ui,sans-serif;text-align:left;max-height:70vh;overflow:auto}strong{display:block;font-size:15px}p{margin:8px 0 14px;overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:8px}button{font:inherit;border:1px solid #cbd5c6;border-radius:7px;padding:5px 10px;background:#f4f7f1;color:#263b24;cursor:pointer}button:focus-visible{outline:2px solid #47743d;outline-offset:2px}button:disabled{opacity:.6;cursor:wait}`;
    const panel = document.createElement('section');
    panel.setAttribute('role',failed ? 'alert' : 'status');
    panel.setAttribute('aria-label',failed ? '句流翻译失败' : '句流翻译提示');
    const title = document.createElement('strong'); title.textContent = failed ? '句流 · 翻译未能继续' : '句流 · 暂无可翻译文字';
    const detail = document.createElement('p'); detail.textContent = text;
    const actions = document.createElement('nav'); actions.setAttribute('aria-label','翻译操作');
    const button = (label,action) => {
      const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
      element.addEventListener('click', async () => {
        element.disabled = true;
        try { await action(); }
        catch (reason) { detail.textContent = C.errorMessage(reason); }
        finally { element.disabled = false; }
      });
      actions.append(element);
    };
    button('查看配置',() => send({type:'OPEN_OPTIONS'}));
    if (failed) button('重试翻译',retry);
    button('关闭提示',() => { dismissedNotice = key; removeNotice(); });
    panel.append(title,detail,actions); root.append(style,panel);
    (document.body || document.documentElement).append(host); notice = host;
  }
  function fail(reason) {
    if (error) return;
    error = C.errorMessage(reason,'翻译失败，请查看配置并测试连接。'); phase = 'error';
    for (const record of records.values()) for (const item of record.sentences) if (item.state === 'loading') item.state = 'pending';
    if (session) void send({type:'CANCEL',session}).catch(() => {});
    update();
  }
  function retry() { const fresh = ignoreCache; restore(); return start({ignoreCache:fresh}); }
  function isIgnored(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP) || parent.isContentEditable || parent.namespaceURI !== 'http://www.w3.org/1999/xhtml') return true;
    const style = getComputedStyle(parent);
    return ['hidden','collapse'].includes(style.visibility) || (style.display !== 'contents' && !parent.getClientRects().length);
  }
  function isTextBlock(element) {
    if (element.matches(BLOCK) || element.matches(UNIT) || standaloneLink(element)) return true;
    // Modern pages often stack <span>s with CSS rather than using paragraphs.
    // Flex/grid items are blockified by computed style, so their labels and
    // numeric values also get independent text ownership.
    const display = getComputedStyle(element).display;
    if (display === 'inline-block') {
      // Adjacent badges/atomic cards are separate. An atomic highlight inside
      // running prose, including a number, still belongs to the whole sentence.
      return ![...element.parentNode.childNodes].some(node => {
        if (node === element) return false;
        if (node.nodeType === 3) return /\p{L}/u.test(node.data);
        if (node.nodeType !== 1 || node.matches(`${BLOCK},${UNIT},${SKIP}`)) return false;
        return ['inline','contents'].includes(getComputedStyle(node).display) && /\p{L}/u.test(node.textContent);
      });
    }
    return ['block','flow-root','flex','grid','inline-flex','inline-grid','list-item','table-cell','table-caption'].includes(display);
  }
  function standaloneLink(element) {
    if (!element.matches('a[href]')) return false;
    // A row consisting of links and separators is a collection of actions.
    // Free text/emphasis around a link gives sentence context and stays joined.
    return [...element.parentNode.childNodes].every(node => {
      if (node.nodeType === 3) return !/\p{L}/u.test(node.data);
      if (node.nodeType !== 1 || node.matches(`a[href],[${MARK}],${SKIP}`)) return true;
      return !/\p{L}/u.test(node.textContent);
    });
  }
  function textBlock(element) {
    for (let current = element; current; current = current.parentElement) if (isTextBlock(current)) return current;
    return element;
  }
  function owner(node) { return node.parentElement && textBlock(node.parentElement); }
  function textNodes(element) {
    const nodes = [];
    // Descendant blocks own their text. Pruning them keeps a feed container
    // cheap to inspect when only one new item has been appended.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode:node => {
        if (node.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
        if (node.hasAttribute(MARK)) return NodeFilter.FILTER_REJECT;
        if (node.matches(SKIP) || isTextBlock(node) || node.matches('br,hr')) {
          // Prune the subtree, but retain its visible boundary. Otherwise
          // "Before <button>Action</button> After" becomes "Before After".
          // Translation spans and hidden/decorative content create no boundary.
          if (!node.closest('[hidden],[inert],[aria-hidden="true"]') && node.getClientRects().length && !['hidden','collapse'].includes(getComputedStyle(node).visibility)) nodes.push(node);
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!isIgnored(node) && owner(node) === element) nodes.push(node);
    }
    return nodes;
  }
  function inScope(node) {
    const parent = node.parentElement;
    if (parent.closest(FIXED)) return prefs.translateFixed;
    // <article> is also used for individual cards, and dashboards often sit
    // alongside <main>. Selecting the first semantic container drops content
    // that existed before START while mutations later admit that same content.
    // Use one body-wide policy for initial and incremental scans. Article mode
    // only omits explicitly complementary static regions; page mode includes them.
    return prefs.scope === 'page' || !parent.closest('aside,[role="complementary"]') || parent.closest(OVERLAY) || [...dynamicRoots].some(region => region.contains(node));
  }
  function readSource(element) {
    const runs = [];
    let nodes = [];
    function flush() {
      const text = nodes.map(node => node.data).join('');
      // Numeric-only visual lines never become part of a translation's source
      // identity. A ticking clock cannot invalidate the adjacent English label.
      if (/\p{L}/u.test(text)) runs.push({nodes,text});
      nodes = [];
    }
    for (const node of textNodes(element).filter(inScope)) {
      if (node.nodeType === 1) flush();
      else nodes.push(node);
    }
    flush();
    return {runs,nodes:runs.flatMap(run => run.nodes),source:JSON.stringify(runs.map(run => run.text))};
  }
  function sameNodes(left, right) { return left.length === right.length && left.every((node,index) => node === right[index]); }
  function scheduleScan() {
    if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scan(false); },250);
  }
  function markDirty(node, deep = false) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (element?.isConnected && !element.closest(`[${MARK}]`)) {
      const block = textBlock(element);
      dirtyOwners.add(block);
      if (deep && element.parentElement) dirtyOwners.add(textBlock(element.parentElement));
      if (deep) {
        let covered = false;
        for (const region of dirtyRoots) {
          if (region.contains(element)) { covered = true; break; }
          if (element.contains(region)) dirtyRoots.delete(region);
        }
        if (!covered) dirtyRoots.add(element);
      }
    }
    scheduleScan();
  }
  function noteDynamic(node) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || element === document.body || element === document.documentElement || element.closest(SKIP)) return;
    for (const region of dynamicRoots) {
      if (!region.isConnected || element.contains(region)) dynamicRoots.delete(region);
      else if (region.contains(element)) return;
    }
    if (dynamicRoots.size < 200) dynamicRoots.add(element);
  }
  function ownMutation(mutation) {
    const element = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
    // A framework can remove just a translation span while keeping the source
    // nodes. Treat removal as a change so the missing translation is restored.
    return element?.closest(`[${MARK}]`) || (mutation.type === 'childList' && !mutation.removedNodes.length && [...mutation.addedNodes].every(node => node.nodeType === 1 && node.hasAttribute(MARK)));
  }
  function nearViewport(element) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom < -600 || rect.top > innerHeight + 900) return false;
    // A nested scrolling panel has its own visible window, even when the
    // panel itself sits near the top of the page.
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (!/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)) continue;
      const clip = parent.getBoundingClientRect();
      if (rect.bottom < clip.top - 600 || rect.top > clip.bottom + 900) return false;
    }
    return true;
  }
  function endpointRange(nodes, end, block) {
    let position = 0;
    for (const node of nodes) {
      if (position + node.length >= end) {
        const range = document.createRange();
        const offset = end - position;
        range.setStart(node, offset); range.collapse(true);
        // Place translations outside a link/emphasis if the sentence ends there.
        if (offset === node.length) {
          let last = node;
          while (last.parentNode !== block && last.parentElement && !last.nextSibling && !isTextBlock(last.parentElement)) last = last.parentElement;
          if (last !== node) { range.setStartAfter(last); range.collapse(true); }
        }
        return range;
      }
      position += node.length;
    }
    return null;
  }
  function scan(full = true) {
    if (!session || paused) return;
    for (const region of dynamicRoots) if (!region.isConnected) dynamicRoots.delete(region);
    const groups = new Map();
    const affected = new Set(full ? records.keys() : dirtyOwners);
    function collect(node) {
      if (node.nodeType !== 3 || isIgnored(node) || !node.data.trim()) return;
      const element = owner(node);
      if (!element || (!element.getClientRects().length && getComputedStyle(element).display !== 'contents')) return;
      const fixed = !!element.closest(FIXED);
      if (!inScope(node)) return;
      if (!groups.has(element)) groups.set(element, { nodes:[], kind:fixed ? 'fixed' : 'article' });
      groups.get(element).nodes.push(node);
    }
    const regions = full ? [document.body] : [...dirtyRoots];
    for (const region of regions) {
      if (!region.isConnected) continue;
      for (const element of records.keys()) if (region.contains(element)) affected.add(element);
      const walker = document.createTreeWalker(region, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode:node => node.nodeType === 1 ? (node.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) collect(node);
    }
    for (const element of dirtyOwners) if (element.isConnected) for (const node of textNodes(element)) collect(node);
    dirtyRoots.clear(); dirtyOwners.clear();
    for (const [element, record] of records) {
      if (!element.isConnected || (affected.has(element) && !groups.has(element))) {
        for (const item of record.sentences) { item.span?.remove(); item.range?.detach(); }
        visibilityObserver?.unobserve(element); records.delete(element);
      }
    }
    for (const [element, group] of groups) {
      // Preserve whitespace and inline markup within each visual text run.
      const source = readSource(element);
      const old = records.get(element);
      if (old?.source === source.source && sameNodes(old.nodes,source.nodes) && old.sentences.every(item => item.state !== 'stale' && (item.state !== 'done' || element.contains(item.span)))) continue;
      const reusable = new Map();
      if (old) {
        for (const item of old.sentences) {
          if (item.state === 'done') reusable.set(item.text,{text:item.span.textContent,cached:item.cached});
          item.span?.remove(); item.range?.detach();
        }
      }
      const record = { element, nodes:source.nodes, source:source.source, sentences:[], eligible:all || !prefs.lazy || nearViewport(element) };
      for (const run of source.runs) {
        let pieces;
        try { pieces = C.segmentText(run.text, element.closest('[lang]')?.lang || undefined); } catch { pieces = C.segmentText(run.text); }
        for (const piece of pieces) {
          // Bound a single pathological block, not the entire scrolling feed.
          if (!C.needsTranslation(piece.text, prefs.targetLanguage) || record.sentences.length >= 5000) continue;
          const range = endpointRange(run.nodes, piece.end, element);
          if (!range) continue;
          record.sentences.push({ id:nextId++, text:piece.text, kind:group.kind, range, state:'pending', record });
        }
      }
      records.set(element, record);
      visibilityObserver?.observe(element);
      for (const item of [...record.sentences].reverse()) {
        const previous = reusable.get(item.text);
        if (previous) { item.cached = previous.cached; render(item,previous.text); }
      }
    }
    update(); pump();
  }
  function observe() {
    observer?.observe(document.body, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['hidden','aria-hidden','class','style','lang','open','popover','aria-expanded','data-state','role','href','translate','contenteditable'] });
  }
  let lastState = '';
  function update() {
    const state = status(), key = JSON.stringify(state);
    if (error) showNotice(error);
    else if (session && phase === 'done' && !state.total) showNotice('当前范围内未找到可翻译文字。可以查看配置中的目标语言、翻译范围和导航开关；图片、PDF、iframe 内文字暂不支持。新增或展开的内容仍会自动检查。',false);
    else removeNotice();
    if (key === lastState) return;
    lastState = key;
    void send({type:'PAGE_STATE',state}).catch(() => {});
  }
  function render(item, translatedText) {
    if (!item.record.element.isConnected || records.get(item.record.element) !== item.record) return;
    const source = readSource(item.record.element);
    if (source.source !== item.record.source || !sameNodes(source.nodes,item.record.nodes)) {
      item.state = 'stale'; markDirty(item.record.element); return;
    }
    // Do not discard page mutations queued before our own DOM insertion.
    handleMutations(observer?.takeRecords() || []);
    observer?.disconnect();
    const span = document.createElement('span'); span.setAttribute(MARK, 'translation');
    span.lang = prefs.targetLanguage;
    span.textContent = translatedText;
    const heading = !!item.record.element.closest('h1,h2,h3,h4,h5,h6,[role="heading"]');
    span.setAttribute('data-sentence-flow-layout', heading ? 'heading' : 'inline');
    // Follow the actual site's text color, including custom dark themes which
    // do not declare color-scheme. No independent colored cards or backgrounds.
    const styles = {
      display:heading ? 'block' : 'inline', color:'inherit', 'background':'transparent',
      border:'0', 'border-radius':'0', padding:'0', 'box-shadow':'none', 'text-shadow':'none',
      'font-family':'inherit', 'font-style':'normal', 'font-weight':'400',
      'font-size':heading ? 'min(1em, clamp(14px, 0.44em, 24px))' : prefs.style === 'plain' ? '1em' : '0.92em',
      'line-height':heading ? '1.55' : 'inherit', 'letter-spacing':'normal', 'text-transform':'none',
      'white-space':'normal', 'vertical-align':'baseline',
      'margin-inline':heading ? '0' : '0.5em', 'margin-block':heading ? '0.45em 0.15em' : '0',
      opacity:prefs.style === 'plain' ? '1' : '0.86', 'text-decoration':'none'
    };
    if (prefs.style === 'underline') {
      styles['text-decoration'] = 'underline dotted color-mix(in srgb, currentColor 38%, transparent)';
      styles['text-decoration-thickness'] = '1px'; styles['text-underline-offset'] = '0.25em';
    }
    // Limit overrides to our own nodes; site-wide span rules must not turn a
    // translation back into a badge, a huge title or an uppercase menu label.
    for (const [property,value] of Object.entries(styles)) span.style.setProperty(property,value,'important');
    try {
      item.range.insertNode(span); item.span = span; item.range.detach(); item.range = null; item.state = 'done'; translated++;
      // insertNode splits a text node; remember our own new nodes so a later
      // framework replacement with identical text can still be detected.
      item.record.nodes = readSource(item.record.element).nodes;
    }
    finally { observe(); }
  }
  function handleMutations(mutations) {
    if (!session) return;
    for (const mutation of mutations) {
      if (ownMutation(mutation)) continue;
      const element = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
      // Link/action rows and atomic inline items depend on their surrounding
      // text. Reassess siblings when that context or a unit's role/style changes.
      if (element && (mutation.type !== 'attributes') && [...element.children].some(child => child.matches('a[href]') || getComputedStyle(child).display === 'inline-block')) markDirty(element,true);
      if (mutation.type === 'attributes' && ['role','href','class','style','translate','contenteditable'].includes(mutation.attributeName) && element.parentElement && element.parentElement !== document.documentElement) markDirty(element.parentElement,true);
      if (mutation.type === 'childList') {
        markDirty(mutation.target);
        if (mutation.addedNodes.length) noteDynamic(mutation.target);
        for (const node of mutation.addedNodes) { noteDynamic(node); markDirty(node,true); }
      } else {
        noteDynamic(mutation.target);
        markDirty(mutation.target,mutation.type === 'attributes');
      }
    }
  }
  function pending() { return [...records.values()].filter(record => record.eligible && record.element.isConnected).flatMap(record => record.sentences.filter(item => item.state === 'pending')); }
  function pump() {
    if (!session || paused || error) return;
    while (busy < 2) {
      const items = C.packItems(pending())[0];
      if (!items?.length) break;
      items.forEach(item => { item.state = 'loading'; });
      phase = 'running';
      busy++; requests++;
      const token = session, run = generation;
      send({ type:'TRANSLATE', session:token, ignoreCache, items:items.map(({id,text,kind}) => ({id,text,kind})) }).then(response => {
        if (session !== token || generation !== run || error) return;
        const byId = new Map(response.results.map(row => [row.id,row]));
        // Live Range endpoints also track splits made by other batches.
        for (const item of [...items].reverse()) {
          const row = byId.get(item.id);
          if (!row) throw new Error('缺少句子译文，请重试。');
          item.cached = row.cached;
          render(item, row.text);
          if (row.cached && item.state === 'done') cacheHits++;
        }
      }).catch(reason => {
        if (session !== token || generation !== run) return;
        const active = items.filter(item => item.state === 'loading' && records.get(item.record.element) === item.record);
        if (!active.length) return;
        active.forEach(item => { item.state = 'pending'; });
        fail(reason);
      }).finally(() => {
        if (session !== token || generation !== run) return;
        busy--;
        if (!busy && !pending().length && !error) phase = [...records.values()].some(record => record.sentences.some(item => item.state === 'pending')) ? 'reading' : 'done';
        update(); pump();
      });
    }
    if (!busy && !pending().length && !error) phase = [...records.values()].some(record => record.sentences.some(item => item.state === 'pending')) ? 'reading' : 'done';
    update();
  }
  async function start(options = {}) {
    if (session) return status();
    session = crypto.randomUUID(); generation++; phase = 'running'; paused = false; all = false; error = '';
    dismissedNotice = ''; removeNotice();
    ignoreCache = options.ignoreCache === true;
    const token = session, run = generation;
    update();
    try {
      await pageReady;
      const config = await send({ type:'PAGE_CONFIG' });
      if (session !== token || generation !== run) return status();
      prefs = config;
    } catch (reason) {
      if (session !== token || generation !== run) return status();
      restore(); fail(reason); throw reason;
    }
    cacheHits = requests = translated = busy = nextId = 0;
    route = location.href;
    visibilityObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { const record = records.get(entry.target); if (record) record.eligible = true; }
      pump();
    }, { rootMargin:'900px 0px' });
    // A bounded throttle keeps continuously updating feeds from starving scans.
    observer = new MutationObserver(handleMutations);
    // Start observing before the first fresh scan so page mutations produced
    // during startup are queued for the following incremental pass.
    observe(); scan(); return status();
  }
  function restore() {
    removeNotice(); dismissedNotice = '';
    const previous = session;
    session = null; generation++; clearTimeout(scanTimer); scanTimer = null;
    observer?.disconnect(); visibilityObserver?.disconnect();
    dirtyRoots.clear(); dirtyOwners.clear();
    for (const record of records.values()) for (const item of record.sentences) { item.span?.remove(); item.range?.detach(); }
    records.clear();
    phase = 'idle'; paused = false; error = ''; busy = cacheHits = requests = translated = 0;
    update();
    if (previous) void send({ type:'CANCEL', session:previous }).catch(() => {});
    return status();
  }
  function togglePause() {
    if (error) return retry();
    paused = error ? false : !paused;
    error = ''; phase = paused ? 'paused' : 'running';
    if (!paused) scan();
    update(); pump(); return status();
  }
  function translateAll() { all = true; for (const record of records.values()) record.eligible = true; pump(); return status(); }
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'PAGE_STATUS') { respond({ ok:true, ...status() }); return; }
    if (message.type === 'PAGE_NOTICE') { showNotice(message.error || '翻译失败，请查看配置并测试连接。'); respond({ok:true}); return; }
    const actions = { START:() => start({ignoreCache:message.ignoreCache}), RESTORE:restore, PAUSE:togglePause, ALL:translateAll, TOGGLE:() => session ? restore() : start() };
    if (!actions[message.type]) return;
    Promise.resolve().then(actions[message.type]).then(data => respond({ ok:true, ...data }), reason => respond({ ok:false, error:reason.message }));
    return true;
  });
  // SPA route changes should not carry old article text or jobs into the next page.
  setInterval(() => {
    if (!session || location.href === route) return;
    restore(); void start().catch(() => {});
  }, 1000);
  // Navigation/BFCache must not leave the old document subscribed to inference.
  window.addEventListener('pagehide',restore);
  globalThis.__sentenceFlow = { status };
  function connectPage() {
    return send({type:'PAGE_READY'}).then(() => { lastState = ''; update(); }).catch(() => {});
  }
  let pageReady = connectPage();
  window.addEventListener('pageshow',event => {
    if (event.persisted) pageReady = connectPage();
  });
})();
