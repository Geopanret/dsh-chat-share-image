/**
 * dsh-chat-share-image — Client half.
 *
 * Adds one camera action to the finished-assistant action strip
 * (`conversation.chat.assistant-actions`). Clicking it renders the whole
 * assistant reply of that Turn into a single PNG long image and writes the
 * image to the system clipboard.
 *
 * Why the browser does the rendering: the reply is already laid out by the
 * host's Markdown renderer, so cloning the rendered row and re-rasterizing it
 * through an SVG <foreignObject> keeps tables, code, KaTeX and attachment
 * images exactly as the user sees them. The only adjustments are (a) opening
 * horizontal scroll containers so a wide table is not clipped, (b) inlining
 * same-origin images and web fonts so the SVG image can load them, and (c)
 * tiling very tall output before drawing it on one canvas.
 *
 * The Host half is an empty shell; this file never talks to it.
 *
 * Plain browser JS, no JSX, no imports besides the host-provided React.
 */
window.__ModuleLoader__.load({
  id: 'dsh-chat-share-image',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'chatShareImage';
    const ACTION_ID = 'share-image';
    const TOAST_ID = 'chat-share-image-toast';
    const STYLE_ID = 'dsh-chat-share-image-css';
    const PREFIX = 'dsh-csi';
    const CAPTURE = {
      PAD: 24,
      MIN_PAPER: 720,
      MAX_PAPER: 1800,
      TABLE_COL: 140,
      MAX_CODE: 2000,
      MAX_SCALE: 2,
      MAX_DIM: 32767,
      MAX_AREA: 64000000,
      MAX_WIDTH: 16384,
      TILE: 20000,
      MAX_IMAGE_BYTES: 25 * 1024 * 1024,
      // Overlong safeguard: keep a single image readable (>= 1x device scale)
      // and split taller replies into sequential PNG parts instead of shrinking
      // the whole reply into unreadable text.
      MIN_SINGLE_SCALE: 1,
      MAX_SINGLE_CSS: 12000,
      SEGMENT_MIN_CSS: 2400,
      MAX_PARTS: 6,
      SKIP_STYLES: new Set([
        'transition',
        'transition-property',
        'transition-duration',
        'transition-delay',
        'transition-timing-function',
        'animation',
        'animation-name',
        'animation-duration',
        'animation-delay',
        'animation-timing-function',
        'animation-iteration-count',
        'animation-direction',
        'animation-fill-mode',
        'animation-play-state',
        'cursor',
        'pointer-events',
        'will-change',
        'scroll-behavior'
      ])
    };

    //#region locale dictionaries

    const ZH = {
      'action.label': '生成本轮回复长截图并复制到剪贴板',
      'action.working': '正在生成回复长截图…',
      'toast.copied': '已复制回复截图（{width} × {height}）',
      'toast.copiedScaled': '已复制回复截图（{width} × {height}，已按上限缩放）',
      'toast.copiedSkipped': '已复制回复截图（{width} × {height}）；{count} 张跨域图片未嵌入',
      'toast.copiedParts': '内容较长，已拆成 {count} 张；第 1 张已复制（{width} × {height}）',
      'toast.copiedPart': '已复制第 {index}/{count} 张（{width} × {height}）',
      'toast.copyPart': '复制第 {index} 张',
      'toast.downloadAll': '下载全部 {count} 张',
      'toast.partCountSuffix': '（共 {count} 张）',
      'toast.working': '正在生成回复长截图…',
      'toast.tooLong': '回复过长：需要拆成 {count} 张（上限 {max} 张）；请分段查看或截取部分内容',
      'toast.clipboardUnavailable': '已生成整段回复截图，但当前页面无法写入剪贴板；可下载 PNG',
      'toast.copyFailed': '截图画好了，但写入剪贴板失败；可重试或下载',
      'toast.renderFailed': '生成回复截图失败：{reason}',
      'toast.noTarget': '找不到这条回复的渲染内容（可能已切换会话）；请刷新后重试',
      'toast.noContent': '这条回复没有可截图的可见内容',
      'toast.tooLarge': '回复过长，超出单张图片上限',
      'toast.download': '下载 PNG',
      'toast.retry': '重试',
      'toast.dismiss': '关闭'
    };

    const EN = {
      'action.label': 'Copy this reply as a long screenshot',
      'action.working': 'Rendering the reply screenshot…',
      'toast.copied': 'Reply screenshot copied ({width} × {height})',
      'toast.copiedScaled': 'Reply screenshot copied ({width} × {height}, scaled to fit)',
      'toast.copiedSkipped': 'Reply screenshot copied ({width} × {height}); {count} cross-origin image(s) not embedded',
      'toast.copiedParts': 'Reply is long; split into {count} images. Image 1 copied ({width} × {height})',
      'toast.copiedPart': 'Copied image {index}/{count} ({width} × {height})',
      'toast.copyPart': 'Copy image {index}',
      'toast.downloadAll': 'Download all {count} images',
      'toast.partCountSuffix': ' ({count} images total)',
      'toast.working': 'Rendering the reply screenshot…',
      'toast.tooLong': 'Reply is too long: it needs {count} images (limit {max}); view it in segments or capture a smaller part',
      'toast.clipboardUnavailable': 'The reply screenshot was rendered, but this page cannot write to the clipboard; download the PNG instead',
      'toast.copyFailed': 'The screenshot was rendered, but writing to the clipboard failed; retry or download it',
      'toast.renderFailed': 'Could not render the reply screenshot: {reason}',
      'toast.noTarget': 'This reply is not rendered right now (the conversation may have changed); refresh and retry',
      'toast.noContent': 'This reply has no visible content to capture',
      'toast.tooLarge': 'The reply is too long for a single image',
      'toast.download': 'Download PNG',
      'toast.retry': 'Retry',
      'toast.dismiss': 'Dismiss'
    };

    //#endregion

    //#region styles

    const CSS = [
      '.' + PREFIX + '-slot{display:inline-flex;align-items:center}',
      '.' + PREFIX + '-btn{position:relative;width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-tertiary);background:transparent;border:none;padding:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .12s,color .12s}',
      '.' + PREFIX + '-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.' + PREFIX + '-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.' + PREFIX + '-btn[data-phase="working"]{cursor:progress;color:var(--dsw-alias-label-secondary)}',
      '.' + PREFIX + '-btn[data-phase="success"]{color:var(--dsw-alias-state-success-primary)}',
      '.' + PREFIX + '-btn[data-phase="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.' + PREFIX + '-btn:disabled{cursor:default;opacity:.65}',
      '.' + PREFIX + '-btn svg{width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(16px + var(--dsh-content-font-delta,0px));display:block}',
      '.' + PREFIX + '-spin{animation:' + PREFIX + '-spin .9s linear infinite;transform-origin:50% 50%}',
      '@keyframes ' + PREFIX + '-spin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion:reduce){.' + PREFIX + '-spin{animation:none}}',
      '.' + PREFIX + '-tip{position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);max-width:260px;padding:4px 8px;border-radius:var(--dsw-radius-sm,6px);border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.4;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s;z-index:30}',
      '.' + PREFIX + '-btn:hover .' + PREFIX + '-tip,.' + PREFIX + '-btn:focus-visible .' + PREFIX + '-tip{opacity:1}',
      '.' + PREFIX + '-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:min(620px,calc(100vw - 48px));padding:10px 14px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.16);z-index:1200;pointer-events:auto}',
      '.' + PREFIX + '-toast[data-kind="error"]{border-color:var(--dsw-alias-state-error-primary)}',
      '.' + PREFIX + '-toast[data-kind="success"]{border-color:var(--dsw-alias-state-success-primary)}',
      '.' + PREFIX + '-toast-icon{display:inline-flex;flex:none;width:16px;height:16px}',
      '.' + PREFIX + '-toast-icon svg{width:16px;height:16px;display:block}',
      '.' + PREFIX + '-toast-text{min-width:0;overflow-wrap:anywhere}',
      '.' + PREFIX + '-toast-btn{flex:none;border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;cursor:pointer;padding:2px 4px;border-radius:var(--dsw-radius-sm,6px)}',
      '.' + PREFIX + '-toast-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.' + PREFIX + '-toast-close{flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;cursor:pointer;padding:0 2px}',
      '.' + PREFIX + '-toast-close:hover{color:var(--dsw-alias-label-primary)}'
    ].join('\n');

    function ensureStyles() {
      if (typeof document === 'undefined') return;
      if (document.getElementById(STYLE_ID) !== null) return;
      const tag = document.createElement('style');
      tag.id = STYLE_ID;
      tag.dataset.plugin = 'dsh-chat-share-image';
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function removeStyles() {
      if (typeof document === 'undefined') return;
      const tag = document.getElementById(STYLE_ID);
      if (tag !== null) tag.remove();
    }

    //#endregion

    //#region screenshot paper styles

    // These rules apply only inside the offscreen capture clone. They are
    // deliberately NOT used in the live UI: the screenshot re-lays tables and
    // preview images for reading, while the conversation keeps its own layout.
    const PAPER_CLASS = PREFIX + '-paper';
    const FIGURE_CLASS = PREFIX + '-figure';
    const PAPER_CSS = [
      '.' + PAPER_CLASS + ' table{width:100%!important;max-width:100%!important;table-layout:auto!important;border-collapse:collapse!important}',
      '.' +
        PAPER_CLASS +
        ' th,.' +
        PAPER_CLASS +
        ' td{max-width:none!important;min-width:0!important;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word!important}',
      '.' + PAPER_CLASS + ' th code,.' + PAPER_CLASS + ' td code{white-space:pre-wrap!important;overflow-wrap:anywhere!important}',
      '.' + PAPER_CLASS + ' img{max-width:100%!important;max-height:none!important;object-fit:contain!important}',
      '.' + PAPER_CLASS + ' .' + FIGURE_CLASS + '{display:block;margin:12px 0;max-width:100%}',
      '.' + PAPER_CLASS + ' .' + FIGURE_CLASS + ' img{display:block;width:auto!important;height:auto!important;border-radius:8px}',
      '.' + PAPER_CLASS + ' .' + PREFIX + '-gallery{display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:12px!important;flex-wrap:nowrap!important;max-width:100%!important}',
      // P0: long unbreakable tokens / URLs may not be the only overflow; wrap
      // them everywhere in the paper clone so the canvas width stays bounded.
      '.' + PAPER_CLASS + ' :where(p,li,blockquote,h1,h2,h3,h4,h5,h6,strong,em,span,div,figcaption){overflow-wrap:anywhere!important;word-break:break-word!important}',
      '.' + PAPER_CLASS + ' a{overflow-wrap:anywhere!important;word-break:break-all!important}',
      '.' + PAPER_CLASS + ' code{overflow-wrap:anywhere!important;word-break:break-word!important}',
      '.' + PAPER_CLASS + ' pre{white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:break-word!important}'
    ].join('\n');

    //#endregion

    //#region toast store

    const toastListeners = new Set();
    let toastValue = null;
    let toastTimer = null;

    function emitToast() {
      for (const listener of toastListeners) {
        try {
          listener();
        } catch {
          // A broken listener must not take the others down.
        }
      }
    }

    function subscribeToast(listener) {
      toastListeners.add(listener);
      return () => {
        toastListeners.delete(listener);
      };
    }

    function getToastSnapshot() {
      return toastValue;
    }

    function dismissToast() {
      if (toastTimer !== null) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      if (toastValue !== null) {
        toastValue = null;
        emitToast();
      }
    }

    function showToast(next) {
      if (toastTimer !== null) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      toastValue = next;
      emitToast();
      if (typeof next.timeoutMs === 'number' && next.timeoutMs > 0) {
        toastTimer = setTimeout(() => {
          toastTimer = null;
          toastValue = null;
          emitToast();
        }, next.timeoutMs);
      }
    }

    function clearToastTimer() {
      if (toastTimer !== null) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
    }

    //#endregion

    //#region capture helpers

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function toText(value) {
      return typeof value === 'string' ? value : String(value ?? '');
    }

    function truncate(text, max) {
      const value = toText(text).replace(/\s+/g, ' ').trim();
      return value.length > max ? value.slice(0, max - 1) + '…' : value;
    }

    function errorMessage(error) {
      if (error && typeof error === 'object') {
        if (typeof error.message === 'string' && error.message.trim() !== '') return error.message;
        if (typeof error.name === 'string' && error.name !== 'Error') return error.name;
      }
      return toText(error) || 'unknown error';
    }

    function isTransparentColor(color) {
      if (typeof color !== 'string' || color === '' || color === 'transparent') return true;
      const match = color.match(/^rgba?\(([^)]+)\)$/);
      if (match === null) return false;
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
      return parts.length === 4 && (!Number.isFinite(parts[3]) || parts[3] === 0);
    }

    function effectiveBackground(element) {
      let node = element;
      while (node !== null && node !== undefined) {
        if (node.nodeType === 1) {
          const color = window.getComputedStyle(node).backgroundColor;
          if (!isTransparentColor(color)) return color;
        }
        node = node.parentElement;
      }
      if (typeof document !== 'undefined' && document.body !== null) {
        const bodyColor = window.getComputedStyle(document.body).backgroundColor;
        if (!isTransparentColor(bodyColor)) return bodyColor;
      }
      return '#ffffff';
    }

    function findFlowContainer(tail) {
      const flow = tail.closest('[data-chat-flow]');
      if (flow !== null) return flow;
      return tail.parentElement;
    }

    /** Pick the DOM row that holds the closing assistant message of a Turn. */
    function locateReplyRow(button, nodeKey) {
      if (typeof document === 'undefined') return null;
      if (typeof nodeKey === 'string' && nodeKey !== '') {
        const matches = [];
        for (const element of document.querySelectorAll('[data-chat-node-key]')) {
          if (element.getAttribute('data-chat-node-key') !== nodeKey) continue;
          matches.push(element);
        }
        if (matches.length > 0) {
          const responseRows = matches.filter((element) => {
            const part = element.getAttribute('data-chat-group-part');
            return part === null || part === undefined || part === 'response';
          });
          const pool = responseRows.length > 0 ? responseRows : matches;
          return pool[pool.length - 1];
        }
      }
      const tail = button.closest('[data-turn-tail]');
      if (tail === null) return null;
      const turn = tail.getAttribute('data-turn-tail');
      if (turn === null) return null;
      const flow = findFlowContainer(tail);
      if (flow === null) return null;
      const candidates = [];
      for (const element of flow.querySelectorAll('[data-chat-flow-kind="assistant-step"]')) {
        if (element.getAttribute('data-chat-turn') !== turn) continue;
        const position = tail.compareDocumentPosition(element);
        if ((position & Node.DOCUMENT_POSITION_PRECEDING) === 0) continue;
        const part = element.getAttribute('data-chat-group-part');
        if (part !== null && part !== undefined && part !== 'response') continue;
        candidates.push(element);
      }
      return candidates.length > 0 ? candidates[candidates.length - 1] : null;
    }

    function replyWidth(row) {
      const rect = row.getBoundingClientRect();
      if (rect.width > 1) return Math.round(rect.width);
      const flow = row.closest('[data-chat-flow]');
      if (flow !== null && flow.clientWidth > 1) return Math.round(flow.clientWidth);
      let widest = 0;
      let node = row.parentElement;
      for (let depth = 0; node !== null && depth < 12; depth += 1) {
        if (node.clientWidth > widest) widest = node.clientWidth;
        node = node.parentElement;
      }
      if (widest > 1) return Math.round(widest);
      return 760;
    }

    function hasVisibleReplyContent(row) {
      if (row.textContent !== null && row.textContent.trim() !== '') return true;
      return row.querySelector('img, svg, canvas, table') !== null;
    }

    /** Widest table in the reply, in cells; drives the paper width. */
    function maxTableColumns(root) {
      let columns = 0;
      for (const table of root.querySelectorAll('table')) {
        for (const row of table.querySelectorAll('tr')) {
          const count = row.children.length;
          if (count > columns) columns = count;
        }
      }
      return columns;
    }

    /** Content width of the screenshot paper: wide tables get more room. */
    function computePaperWidth(baseWidth, tableColumns) {
      const candidate = Math.max(baseWidth, tableColumns * CAPTURE.TABLE_COL);
      return Math.min(CAPTURE.MAX_PAPER, Math.max(CAPTURE.MIN_PAPER, Math.round(candidate)));
    }

    function isTableRelated(element) {
      const tag = element.tagName;
      if (tag === 'TABLE' || tag === 'THEAD' || tag === 'TBODY' || tag === 'TR' || tag === 'TD' || tag === 'TH') return true;
      if (element.closest('table') !== null) return true;
      return element.querySelector('table') !== null;
    }

    function isCodeRelated(element) {
      const tag = element.tagName;
      if (tag === 'PRE' || tag === 'CODE') return true;
      if (element.closest('pre, .katex, .katex-display') !== null) return true;
      return element.querySelector('pre, .katex, .katex-display') !== null;
    }

    /**
     * Find every element that clips or scrolls its content while the reply is
     * still laid out (detached clones have zero layout, so measuring must happen
     * on the live row first).
     */
    function collectClipping(row) {
      const elements = [row, ...row.querySelectorAll('*')];
      const flags = [];
      for (let index = 0; index < elements.length; index += 1) {
        const element = elements[index];
        if (!(element instanceof HTMLElement)) continue;
        const computed = window.getComputedStyle(element);
        if (computed.display === 'none' || computed.visibility === 'hidden') continue;
        const overflowClipped = computed.overflowX !== 'visible' || computed.overflowY !== 'visible';
        const maxHeight = computed.maxHeight !== 'none' && computed.maxHeight !== '';
        const vertical = element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1;
        const horizontal = element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
        if (!overflowClipped && !maxHeight && !vertical && !horizontal) continue;
        flags.push({
          index,
          vertical,
          horizontal,
          table: isTableRelated(element),
          code: isCodeRelated(element),
          scrollWidth: horizontal ? element.scrollWidth : 0,
          tag: element.tagName
        });
      }
      return flags;
    }

    /**
     * getComputedStyle freezes the live layout as inline px width/height. That
     * is wrong once the paper width or table layout changes: a table wrapper
     * would keep its old height and the taller re-flowed table would overlap
     * the next paragraph. Drop frozen sizes on non-replaced elements and let
     * the paper layout re-flow naturally.
     */
    function clearFrozenLayout(cloneRoot) {
      const elements = [cloneRoot, ...cloneRoot.querySelectorAll('*')];
      for (const element of elements) {
        if (!(element instanceof HTMLElement)) continue;
        const tag = element.tagName;
        if (tag === 'IMG' || tag === 'CANVAS' || tag === 'VIDEO' || tag === 'IFRAME' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          continue;
        }
        element.style.setProperty('width', 'auto');
        element.style.setProperty('min-width', '0');
        element.style.setProperty('max-width', 'none');
        element.style.setProperty('height', 'auto');
        element.style.setProperty('min-height', '0');
        element.style.setProperty('max-height', 'none');
      }
    }

    /** Re-open every clipped/scroll container inside the clone. */
    function applyClippingNormalization(cloneRoot, flags) {
      if (flags.length === 0) return;
      const clones = [cloneRoot, ...cloneRoot.querySelectorAll('*')];
      for (const flag of flags) {
        const element = clones[flag.index];
        if (element === undefined || element === null) continue;
        element.style.setProperty('overflow', 'visible');
        element.style.setProperty('overflow-x', 'visible');
        element.style.setProperty('overflow-y', 'visible');
        element.style.setProperty('max-height', 'none');
        element.style.setProperty('min-height', '0');
        if (flag.vertical) element.style.setProperty('height', 'auto');
        if (!flag.horizontal) continue;
        if (flag.table) continue; // table reflow belongs to the paper stylesheet
        if (flag.code) {
          const target = Math.max(CAPTURE.MIN_PAPER, Math.min(flag.scrollWidth, CAPTURE.MAX_CODE));
          element.style.setProperty('width', target + 'px');
          element.style.setProperty('max-width', 'none');
          if (flag.scrollWidth > CAPTURE.MAX_CODE) {
            element.style.setProperty('white-space', 'pre-wrap');
            element.style.setProperty('overflow-wrap', 'anywhere');
          }
        } else {
          element.style.setProperty('white-space', 'normal');
          element.style.setProperty('overflow-wrap', 'anywhere');
          element.style.setProperty('word-break', 'break-word');
        }
      }
    }

    /** Replace one UI image preview with a full-size image block. */
    function replacePreviewWithFigure(button) {
      const image = button.querySelector('img');
      if (image === null) return null;
      const source = image.getAttribute('src');
      if (source === null || source === '') return null;
      const figure = document.createElement('span');
      figure.className = FIGURE_CLASS;
      const full = document.createElement('img');
      full.setAttribute('src', source);
      full.setAttribute('alt', image.getAttribute('alt') || '');
      full.setAttribute('loading', 'eager');
      full.setAttribute('decoding', 'async');
      figure.appendChild(full);
      button.replaceWith(figure);
      return figure;
    }

    /**
     * The UI caps referenced images to tiny previews (markdown images to
     * max-height 360px, attachment frames to 240/64/48px with object-fit
     * cover). Reuse the same image source but present it at its natural size,
     * limited only by the paper width.
     */
    function enlargeReferencedImages(cloneRoot) {
      for (const button of [...cloneRoot.querySelectorAll('button[data-variant]')]) {
        if (button.querySelector('img') === null) continue;
        replacePreviewWithFigure(button);
      }
      for (const button of [...cloneRoot.querySelectorAll('button')]) {
        if (button.getAttribute('data-variant') !== null) continue;
        const children = [...button.children];
        if (children.length !== 1 || children[0].tagName !== 'IMG') continue;
        replacePreviewWithFigure(button);
      }
      for (const element of [cloneRoot, ...cloneRoot.querySelectorAll('div')]) {
        if (!(element instanceof HTMLElement)) continue;
        const children = [...element.children];
        if (!children.some((child) => child.classList.contains(FIGURE_CLASS))) continue;
        element.classList.add(PREFIX + '-gallery');
      }
      for (const image of cloneRoot.querySelectorAll('img')) {
        image.removeAttribute('srcset');
        image.removeAttribute('sizes');
        image.setAttribute('loading', 'eager');
        image.setAttribute('decoding', 'async');
        image.style.setProperty('max-height', 'none');
        image.style.setProperty('max-width', '100%');
        image.style.setProperty('object-fit', 'contain');
        if (image.closest('.' + FIGURE_CLASS) === null) {
          image.style.setProperty('width', 'auto');
          image.style.setProperty('height', 'auto');
        }
      }
    }

    function copyComputedStyles(sourceRoot, cloneRoot) {
      const sources = [sourceRoot, ...sourceRoot.querySelectorAll('*')];
      const clones = [cloneRoot, ...cloneRoot.querySelectorAll('*')];
      const total = Math.min(sources.length, clones.length);
      for (let index = 0; index < total; index += 1) {
        const source = sources[index];
        const target = clones[index];
        if (source.nodeType !== 1 || target.nodeType !== 1) continue;
        let cssText = '';
        const computed = window.getComputedStyle(source);
        for (const property of computed) {
          if (CAPTURE.SKIP_STYLES.has(property)) continue;
          const value = computed.getPropertyValue(property);
          if (value === '') continue;
          cssText += property + ':' + value + ';';
        }
        target.style.cssText = cssText;
      }
    }

    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(toText(reader.result));
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
    }

    async function fetchAsDataUrl(source) {
      const url = toText(source).trim();
      if (url === '') throw new Error('empty image source');
      if (url.startsWith('data:')) return url;
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('image http ' + response.status);
      const blob = await response.blob();
      if (blob.size > CAPTURE.MAX_IMAGE_BYTES) throw new Error('image too large');
      return await blobToDataUrl(blob);
    }

    function replaceImageWithPlaceholder(image, index) {
      const alt = (image.getAttribute('alt') || '').trim();
      const label = alt === '' ? 'image' : truncate(alt, 60);
      const placeholder = document.createElement('span');
      placeholder.setAttribute(
        'style',
        [
          'display:inline-flex',
          'align-items:center',
          'justify-content:center',
          'box-sizing:border-box',
          'min-width:160px',
          'min-height:44px',
          'padding:8px 12px',
          'border:1px dashed rgba(128,128,128,.55)',
          'border-radius:8px',
          'color:rgba(128,128,128,.95)',
          'font:12px/1.4 sans-serif'
        ].join(';')
      );
      placeholder.textContent = '[image: ' + label + ']';
      image.replaceWith(placeholder);
      return index;
    }

    async function inlineImages(cloneRoot) {
      const images = [...cloneRoot.querySelectorAll('img')];
      const skipped = [];
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        const source = image.getAttribute('src');
        image.removeAttribute('srcset');
        image.removeAttribute('sizes');
        image.setAttribute('loading', 'eager');
        image.setAttribute('decoding', 'sync');
        if (source === null || source === '') continue;
        if (source.startsWith('data:')) continue;
        try {
          const dataUrl = await fetchAsDataUrl(source);
          image.setAttribute('src', dataUrl);
        } catch {
          skipped.push(index);
          replaceImageWithPlaceholder(image, index);
        }
      }
      return skipped.length;
    }

    async function inlineBackgrounds(cloneRoot) {
      const elements = [cloneRoot, ...cloneRoot.querySelectorAll('*')];
      let touched = 0;
      for (const element of elements) {
        if (touched >= 20) break;
        if (!(element instanceof HTMLElement)) continue;
        const background = element.style.backgroundImage;
        if (background === '' || background === 'none' || background.indexOf('url(') === -1) continue;
        touched += 1;
        const urls = [];
        const pattern = /url\((['"]?)(.*?)\1\)/g;
        let match = pattern.exec(background);
        while (match !== null) {
          if (match[2] !== '') urls.push(match[2]);
          match = pattern.exec(background);
        }
        let next = background;
        for (const url of urls) {
          if (url.startsWith('data:')) continue;
          try {
            const dataUrl = await fetchAsDataUrl(url);
            next = next.split(url).join(dataUrl);
          } catch {
            next = 'none';
          }
        }
        element.style.backgroundImage = next;
      }
    }

    async function waitForImages(root) {
      const images = [...root.querySelectorAll('img')];
      await Promise.all(
        images.map((image) => {
          if (typeof image.decode !== 'function') return Promise.resolve();
          return image.decode().catch(() => {});
        })
      );
    }

    function usedFontFamilies(root) {
      const families = new Set();
      const elements = [root, ...root.querySelectorAll('*')];
      for (const element of elements) {
        if (element.nodeType !== 1) continue;
        const family = window.getComputedStyle(element).fontFamily;
        if (family === '') continue;
        for (const part of family.split(',')) {
          const name = part.trim().replace(/^["']|["']$/g, '');
          if (name !== '') families.add(name.toLowerCase());
        }
      }
      return families;
    }

    function absoluteUrl(value, base) {
      try {
        return new URL(value, base).href;
      } catch {
        return null;
      }
    }

    function fontSourceUrl(rule, sheetHref) {
      const src = rule.style.getPropertyValue('src');
      if (src === '') return null;
      const pattern = /url\((['"]?)(.*?)\1\)/g;
      const match = pattern.exec(src);
      if (match === null) return null;
      return absoluteUrl(match[2], sheetHref || document.baseURI);
    }

    function fontFaceDescriptor(rule, sheetHref) {
      const family = rule.style.getPropertyValue('font-family').replace(/^["']|["']$/g, '').trim();
      if (family === '') return null;
      const url = fontSourceUrl(rule, sheetHref);
      if (url === null) return null;
      return {
        family,
        url,
        weight: rule.style.getPropertyValue('font-weight') || 'normal',
        style: rule.style.getPropertyValue('font-style') || 'normal',
        stretch: rule.style.getPropertyValue('font-stretch') || 'normal',
        display: rule.style.getPropertyValue('font-display') || 'block',
        unicodeRange: rule.style.getPropertyValue('unicode-range') || ''
      };
    }

    const fontDataCache = new Map();

    async function fontDataUrl(url) {
      if (fontDataCache.has(url)) return fontDataCache.get(url);
      const promise = (async () => {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('font http ' + response.status);
        const blob = await response.blob();
        if (blob.size > 4 * 1024 * 1024) throw new Error('font too large');
        return await blobToDataUrl(blob);
      })();
      fontDataCache.set(url, promise);
      try {
        return await promise;
      } catch (error) {
        fontDataCache.delete(url);
        throw error;
      }
    }

    async function collectFontFaceCss(sourceRoot, cloneRoot) {
      if (typeof document === 'undefined') return '';
      if (cloneRoot.querySelector('.katex, .katex-display, .math, .MathJax') === null) return '';
      const families = usedFontFamilies(sourceRoot);
      if (families.size === 0) return '';
      const descriptors = [];
      const seen = new Set();
      for (const sheet of Array.from(document.styleSheets)) {
        let rules = null;
        try {
          rules = sheet.cssRules;
        } catch {
          rules = null;
        }
        if (rules === null) continue;
        for (const rule of Array.from(rules)) {
          if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
          const descriptor = fontFaceDescriptor(rule, sheet.href);
          if (descriptor === null) continue;
          if (!families.has(descriptor.family.toLowerCase())) continue;
          const key = descriptor.family + '|' + descriptor.weight + '|' + descriptor.style + '|' + descriptor.unicodeRange;
          if (seen.has(key)) continue;
          seen.add(key);
          descriptors.push(descriptor);
        }
      }
      if (descriptors.length === 0) return '';
      const blocks = [];
      for (const descriptor of descriptors) {
        try {
          const dataUrl = await fontDataUrl(descriptor.url);
          const parts = [
            'font-family:' + JSON.stringify(descriptor.family),
            'font-style:' + descriptor.style,
            'font-weight:' + descriptor.weight,
            'font-stretch:' + descriptor.stretch,
            'font-display:' + descriptor.display,
            'src:url(' + JSON.stringify(dataUrl) + ')'
          ];
          if (descriptor.unicodeRange !== '') parts.push('unicode-range:' + descriptor.unicodeRange);
          blocks.push('@font-face{' + parts.join(';') + '}');
        } catch {
          // A font that cannot be fetched only lowers fidelity; never fail the capture.
        }
      }
      return blocks.join('\n');
    }

    function textColor(element) {
      const color = window.getComputedStyle(element).color;
      return color === '' ? 'inherit' : color;
    }

    /** Build the serializable wrapper: surface background, padding, paper CSS, fonts, clone. */
    function buildWrapper(clone, width, background, color, fontCss, paperCss) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = [
        'box-sizing:border-box',
        'width:' + (width + CAPTURE.PAD * 2) + 'px',
        'padding:' + CAPTURE.PAD + 'px',
        'margin:0',
        'background:' + background,
        'color:' + color,
        'overflow:visible',
        'position:relative',
        'isolation:isolate'
      ].join(';');
      const paperStyle = document.createElement('style');
      paperStyle.textContent = paperCss;
      wrapper.appendChild(paperStyle);
      if (fontCss !== '') {
        const fontStyle = document.createElement('style');
        fontStyle.textContent = fontCss;
        wrapper.appendChild(fontStyle);
      }
      wrapper.appendChild(clone);
      return wrapper;
    }

    async function measureWrapper(wrapper, clone) {
      const host = document.createElement('div');
      host.style.cssText =
        'position:fixed;left:-200000px;top:0;width:auto;height:auto;visibility:hidden;pointer-events:none;overflow:visible;z-index:-1;';
      host.appendChild(wrapper);
      document.body.appendChild(host);
      try {
        if (typeof document.fonts !== 'undefined' && document.fonts !== null && document.fonts.ready !== undefined) {
          try {
            await document.fonts.ready;
          } catch {
            // ignore font readiness failures
          }
        }
        await waitForImages(clone);
        await delay(0);
        const wrapperRect = wrapper.getBoundingClientRect();
        let width = Math.max(wrapper.clientWidth, Math.ceil(wrapper.scrollWidth));
        const left = wrapperRect.left;
        let maxRight = wrapperRect.left + wrapperRect.width;
        for (const element of [clone, ...clone.querySelectorAll('*')]) {
          if (element.nodeType !== 1) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.right > maxRight) maxRight = rect.right;
        }
        width = Math.max(width, Math.ceil(maxRight - left) + CAPTURE.PAD);
        wrapper.style.width = width + 'px';
        await delay(0);
        const height = Math.max(1, Math.ceil(wrapper.getBoundingClientRect().height));
        return { width, height };
      } finally {
        host.remove();
      }
    }

    /**
     * Build the SVG for one tile at device resolution. The serialized wrapper is
     * laid out CSS-pixel for CSS-pixel, then scaled inside the SVG so text is
     * rasterized at the final pixel density (2x by default) instead of being
     * upscaled after decoding.
     */
    function tileSvg(wrapperXml, x, y, tileWidth, tileHeight, fullWidth, fullHeight, scale) {
      const deviceWidth = Math.max(1, Math.round(tileWidth * scale));
      const deviceHeight = Math.max(1, Math.round(tileHeight * scale));
      const html =
        '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' +
        deviceWidth +
        'px;height:' +
        deviceHeight +
        'px;overflow:hidden">' +
        '<div style="position:relative;width:' +
        fullWidth +
        'px;height:' +
        fullHeight +
        'px;overflow:hidden;transform:scale(' +
        scale +
        ');transform-origin:0 0">' +
        '<div style="position:absolute;left:' +
        -x +
        'px;top:' +
        -y +
        'px">' +
        wrapperXml +
        '</div></div></div>';
      return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        deviceWidth +
        '" height="' +
        deviceHeight +
        '" viewBox="0 0 ' +
        deviceWidth +
        ' ' +
        deviceHeight +
        '"><foreignObject x="0" y="0" width="' +
        deviceWidth +
        '" height="' +
        deviceHeight +
        '">' +
        html +
        '</foreignObject></svg>'
      );
    }

    function computeScale(width, height) {
      let scale = CAPTURE.MAX_SCALE;
      if (width <= 0 || height <= 0) throw new Error('empty capture size');
      scale = Math.min(scale, CAPTURE.MAX_DIM / width, CAPTURE.MAX_DIM / height);
      scale = Math.min(scale, Math.sqrt(CAPTURE.MAX_AREA / (width * height)));
      scale = Math.min(scale, CAPTURE.MAX_WIDTH / width);
      if (!Number.isFinite(scale) || scale <= 0) scale = 0.05;
      return Math.min(CAPTURE.MAX_SCALE, Math.max(0.05, scale));
    }

    async function drawSvgTile(svg, ctx, deviceX, deviceY, deviceWidth, deviceHeight) {
      // A blob-URL SVG that contains <foreignObject> taints the canvas in
      // Chromium; a data-URL SVG (base64) stays origin-clean.
      const dataUrl = await blobToDataUrl(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      ctx.drawImage(image, deviceX, deviceY, deviceWidth, deviceHeight);
    }

    async function rasterize(wrapper, width, height, background) {
      const scale = computeScale(width, height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('canvas 2d context unavailable');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const wrapperXml = new XMLSerializer().serializeToString(wrapper);
      for (let y = 0; y < height; y += CAPTURE.TILE) {
        const tileHeight = Math.min(CAPTURE.TILE, height - y);
        for (let x = 0; x < width; x += CAPTURE.TILE) {
          const tileWidth = Math.min(CAPTURE.TILE, width - x);
          const svg = tileSvg(wrapperXml, x, y, tileWidth, tileHeight, width, height, scale);
          await drawSvgTile(
            svg,
            ctx,
            Math.round(x * scale),
            Math.round(y * scale),
            Math.max(1, Math.round(tileWidth * scale)),
            Math.max(1, Math.round(tileHeight * scale))
          );
        }
      }
      return { canvas, scale, width: canvas.width, height: canvas.height };
    }

    function canvasToBlob(canvas) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob === null) reject(new Error('canvas.toBlob returned null'));
          else resolve(blob);
        }, 'image/png');
      });
    }

    /** Height target for one part of an overlong reply (device scale 2). */
    function segmentHeightFor(width) {
      const byArea = (CAPTURE.MAX_AREA * 0.8) / (4 * Math.max(1, width));
      const byDim = (CAPTURE.MAX_DIM * 0.8) / 2;
      const target = Math.min(CAPTURE.MAX_SINGLE_CSS, byArea, byDim);
      return Math.max(CAPTURE.SEGMENT_MIN_CSS, Math.floor(target / 100) * 100);
    }

    async function rasterizeSegment(wrapper, width, fullHeight, yStart, yEnd, background) {
      const segmentHeight = yEnd - yStart;
      if (segmentHeight <= 0) throw new Error('empty capture segment');
      const scale = computeScale(width, segmentHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(segmentHeight * scale));
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('canvas 2d context unavailable');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const wrapperXml = new XMLSerializer().serializeToString(wrapper);
      for (let y = yStart; y < yEnd; y += CAPTURE.TILE) {
        const tileHeight = Math.min(CAPTURE.TILE, yEnd - y);
        for (let x = 0; x < width; x += CAPTURE.TILE) {
          const tileWidth = Math.min(CAPTURE.TILE, width - x);
          const svg = tileSvg(wrapperXml, x, y, tileWidth, tileHeight, width, fullHeight, scale);
          await drawSvgTile(
            svg,
            ctx,
            Math.round(x * scale),
            Math.round((y - yStart) * scale),
            Math.max(1, Math.round(tileWidth * scale)),
            Math.max(1, Math.round(tileHeight * scale))
          );
        }
      }
      return { canvas, scale, width: canvas.width, height: canvas.height };
    }

    /** P0: decode the produced PNG and assert its size matches the canvas. */
    async function verifyPngBlob(blob, width, height) {
      if (!(blob instanceof Blob)) throw new Error('self-check: capture did not produce a Blob');
      if (blob.size < 1024) throw new Error('self-check: PNG is suspiciously small');
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        throw new Error('self-check: invalid canvas dimensions');
      }
      const url = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        if (image.naturalWidth !== width || image.naturalHeight !== height) {
          throw new Error('self-check: PNG dimensions do not match the canvas');
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    async function captureCanvas(shot) {
      let blob;
      try {
        blob = await canvasToBlob(shot.canvas);
      } catch (error) {
        if (error && error.name === 'SecurityError') {
          throw new Error('the captured reply pulled in a cross-origin resource that tainted the canvas');
        }
        throw error;
      }
      await verifyPngBlob(blob, shot.width, shot.height);
      return blob;
    }

    async function captureReplyImage(row) {
      const baseWidth = replyWidth(row);
      const tableColumns = maxTableColumns(row);
      const paperWidth = computePaperWidth(baseWidth, tableColumns);
      const background = effectiveBackground(row);
      const foreground = textColor(row);
      const clipping = collectClipping(row);
      const clone = row.cloneNode(true);
      copyComputedStyles(row, clone);
      clearFrozenLayout(clone);
      clone.classList.add(PAPER_CLASS);
      clone.style.setProperty('width', paperWidth + 'px');
      clone.style.setProperty('min-width', '0');
      clone.style.setProperty('max-width', 'none');
      clone.style.setProperty('margin', '0');
      clone.style.setProperty('padding', '0');
      clone.style.setProperty('display', 'block');
      clone.style.setProperty('position', 'static');
      clone.style.setProperty('transform', 'none');
      clone.style.setProperty('box-sizing', 'border-box');
      clone.style.setProperty('overflow', 'visible');
      clone.removeAttribute('hidden');
      applyClippingNormalization(clone, clipping);
      enlargeReferencedImages(clone);
      const skippedImages = await inlineImages(clone);
      await inlineBackgrounds(clone);
      const fontCss = await collectFontFaceCss(row, clone);
      const wrapper = buildWrapper(clone, paperWidth, background, foreground, fontCss, PAPER_CSS);
      const size = await measureWrapper(wrapper, clone);
      if (size.width > CAPTURE.MAX_WIDTH) {
        throw new Error('capture exceeds the single-image limit');
      }
      const singleScale = computeScale(size.width, size.height);
      const needsSplit = size.height > CAPTURE.MAX_SINGLE_CSS || singleScale < CAPTURE.MIN_SINGLE_SCALE;
      let parts;
      if (needsSplit) {
        const segmentHeight = segmentHeightFor(size.width);
        const totalParts = Math.ceil(size.height / segmentHeight);
        if (totalParts > CAPTURE.MAX_PARTS) {
          const error = new Error('reply too long: ' + totalParts + ' parts (limit ' + CAPTURE.MAX_PARTS + ')');
          error.code = 'tooLong';
          error.parts = totalParts;
          error.max = CAPTURE.MAX_PARTS;
          throw error;
        }
        parts = [];
        for (let y = 0; y < size.height; y += segmentHeight) {
          const yEnd = Math.min(size.height, y + segmentHeight);
          const shot = await rasterizeSegment(wrapper, size.width, size.height, y, yEnd, background);
          const blob = await captureCanvas(shot);
          parts.push({ blob, width: shot.width, height: shot.height, scale: shot.scale });
          shot.canvas.width = 0;
          shot.canvas.height = 0;
          await delay(0);
        }
      } else {
        const shot = await rasterize(wrapper, size.width, size.height, background);
        const blob = await captureCanvas(shot);
        parts = [{ blob, width: shot.width, height: shot.height, scale: shot.scale }];
        shot.canvas.width = 0;
        shot.canvas.height = 0;
      }
      const first = parts[0];
      return {
        blob: first.blob,
        parts,
        width: first.width,
        height: first.height,
        totalWidth: size.width,
        totalHeight: size.height,
        split: parts.length > 1,
        scaled: parts.some((part) => part.scale < CAPTURE.MAX_SCALE),
        skippedImages,
        background
      };
    }

    //#endregion

    //#region clipboard and download

    function canWriteClipboard() {
      if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false;
      if (typeof navigator.clipboard.write !== 'function') return false;
      return typeof window.ClipboardItem === 'function';
    }

    async function writeClipboardFromCapture(captureOnce) {
      // Pass a Promise<Blob> to ClipboardItem so the write starts inside the
      // click's user activation while rendering continues asynchronously.
      const toBlob = () => captureOnce().then((result) => result.blob);
      try {
        const item = new window.ClipboardItem({ 'image/png': toBlob() });
        await navigator.clipboard.write([item]);
        return { copied: true };
      } catch (firstError) {
        try {
          const result = await captureOnce();
          await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': result.blob })]);
          return { copied: true };
        } catch (secondError) {
          return { copied: false, error: secondError || firstError };
        }
      }
    }

    function timestamp() {
      return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    }

    function downloadBlob(blob, name) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = typeof name === 'string' && name !== '' ? name : 'dsh-reply-' + timestamp() + '.png';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    /** Download every part of an overlong reply; one file per part. */
    function downloadParts(parts) {
      if (!Array.isArray(parts) || parts.length === 0) return;
      const stamp = timestamp();
      const width = String(parts.length).length;
      parts.forEach((part, index) => {
        const suffix = parts.length > 1 ? '-' + String(index + 1).padStart(width, '0') + 'of' + parts.length : '';
        setTimeout(() => {
          try {
            downloadBlob(part.blob, 'dsh-reply-' + stamp + suffix + '.png');
          } catch {
            // A single failed download must not abort the remaining parts.
          }
        }, index * 350);
      });
    }

    //#endregion

    //#region toast helpers

    function toastIcon(kind) {
      if (kind === 'success') {
        return h(
          'svg',
          { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M4 12.5 9.5 18 20 6.5' })
        );
      }
      if (kind === 'error') {
        return h(
          'svg',
          { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M12 7v6' }),
          h('circle', { cx: 12, cy: 17, r: 0.6, fill: 'currentColor', stroke: 'none' })
        );
      }
      return null;
    }

    //#endregion

    //#region capture queue

    let captureQueue = Promise.resolve();

    function enqueueCapture(task) {
      const run = captureQueue.then(task, task);
      captureQueue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }

    //#endregion

    //#region action component

    /**
     * Contain any render failure to this plugin's own entry. A throwing entry in
     * a list slot blanks every sibling in that slot, so this boundary protects
     * the host's copy / feedback / context buttons from our bugs.
     */
    class ShareImageBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }

      static getDerivedStateFromError() {
        return { failed: true };
      }

      componentDidCatch(error) {
        try {
          console.error('[chat-share-image] entry crashed', error);
        } catch {
          // ignore
        }
      }

      render() {
        return this.state.failed ? null : this.props.children;
      }
    }

    function ShareImageActionView(props) {
      const { messageId, nodeKey, t } = props;
      const translate = typeof t === 'function' ? t : (key) => key;
      const [phase, setPhase] = React.useState('idle');
      const aliveRef = React.useRef(true);
      const timerRef = React.useRef(null);
      const busyRef = React.useRef(false);

      React.useEffect(() => {
        aliveRef.current = true;
        return () => {
          aliveRef.current = false;
          if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
        };
      }, []);

      const flash = React.useCallback((next, ms) => {
        if (!aliveRef.current) return;
        setPhase(next);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (aliveRef.current) setPhase('idle');
        }, ms);
      }, []);

      const label = phase === 'working' ? translate('action.working') : translate('action.label');

      const onClick = React.useCallback(
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (busyRef.current) return;
          const button = event.currentTarget;
          busyRef.current = true;
          if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          setPhase('working');
          runCapture({
            button,
            messageId,
            nodeKey,
            translate,
            setPhase,
            isAlive: () => aliveRef.current,
            flash,
            done: () => {
              busyRef.current = false;
            }
          });
        },
        [flash, messageId, nodeKey, translate]
      );

      const icon =
        phase === 'working'
          ? h(
              'svg',
              { viewBox: '0 0 24 24', 'aria-hidden': true },
              h('circle', {
                cx: 12,
                cy: 12,
                r: 8,
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 2.2,
                strokeLinecap: 'round',
                strokeDasharray: '30 20',
                className: PREFIX + '-spin'
              })
            )
          : phase === 'success'
            ? h(
                'svg',
                { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
                h('path', { d: 'M4.5 12.5 9.5 17.5 19.5 6.5' })
              )
            : phase === 'error'
              ? h(
                  'svg',
                  { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
                  h('path', { d: 'M12 6.5v7.5' }),
                  h('circle', { cx: 12, cy: 17.5, r: 0.7, fill: 'currentColor', stroke: 'none' })
                )
              : h(
                  'svg',
                  { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
                  h('path', { d: 'M4.4 8.7h2.3l1.3-2.1h8l1.3 2.1h2.3a1.6 1.6 0 0 1 1.6 1.6v6.9a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6v-6.9a1.6 1.6 0 0 1 1.6-1.6Z' }),
                  h('circle', { cx: 12, cy: 13.7, r: 3.2 })
                );

      return h(
        'button',
        {
          type: 'button',
          className: PREFIX + '-btn',
          'aria-label': label,
          title: label,
          'data-phase': phase,
          'data-dsh-share-image': 'action',
          disabled: phase === 'working',
          onClick
        },
        icon,
        h('span', { className: PREFIX + '-tip', role: 'tooltip' }, label)
      );
    }

    /** Calls the standard `useChat` hook only when the host provides it. */
    function ShareImageActionWithChat(props) {
      const useChat = props.useChat;
      const nodeKey = useChat((snapshot) => {
        try {
          if (snapshot === undefined || snapshot === null) return null;
          const nodes = snapshot.nodes;
          if (nodes === undefined || nodes === null) return null;
          const list = typeof nodes.values === 'function' ? nodes.values() : Array.isArray(nodes) ? nodes : [];
          const target = String(props.messageId);
          for (const node of list) {
            if (node === undefined || node === null || node.kind !== 'assistant-step') continue;
            const data = node.data;
            const finalNode = data === undefined || data === null ? undefined : data.finalNode;
            if (finalNode === undefined || finalNode === null) continue;
            if (String(finalNode.messageId) === target) return typeof node.key === 'string' ? node.key : null;
          }
          return null;
        } catch {
          // A hook selector must never throw: one broken entry would blank the
          // whole assistant action strip for every message.
          return null;
        }
      });
      return h(ShareImageActionView, { ...props, nodeKey });
    }

    function ShareImageAction(props) {
      const inner =
        typeof props.useChat !== 'function'
          ? h(ShareImageActionView, { ...props, nodeKey: null })
          : h(ShareImageActionWithChat, props);
      return h(ShareImageBoundary, null, inner);
    }

    async function runCapture(context) {
      const { button, messageId, nodeKey, translate, setPhase, isAlive, flash, done } = context;
      let progressTimer = null;
      const clearProgress = () => {
        if (progressTimer !== null) {
          clearTimeout(progressTimer);
          progressTimer = null;
        }
      };
      const tooLongText = (error) =>
        translate('toast.tooLong', {
          count: error !== null && error !== undefined && error.parts !== undefined ? error.parts : '?',
          max: error !== null && error !== undefined && error.max !== undefined ? error.max : CAPTURE.MAX_PARTS
        });
      try {
        const row = locateReplyRow(button, nodeKey);
        if (row === null) {
          showToast({ kind: 'error', text: translate('toast.noTarget'), timeoutMs: 8000 });
          flash('error', 2200);
          return;
        }
        if (!hasVisibleReplyContent(row)) {
          showToast({ kind: 'error', text: translate('toast.noContent'), timeoutMs: 8000 });
          flash('error', 2200);
          return;
        }
        if (!isAlive()) return;
        if (typeof setPhase === 'function') setPhase('working');
        progressTimer = setTimeout(() => {
          progressTimer = null;
          if (isAlive()) showToast({ kind: 'info', text: translate('toast.working'), timeoutMs: 0 });
        }, 500);
        let captured = null;
        const captureOnce = () => {
          if (captured === null) captured = enqueueCapture(() => captureReplyImage(row));
          return captured;
        };
        const clipboardAvailable = canWriteClipboard();
        let copied = false;
        let copyError = null;
        if (clipboardAvailable) {
          const result = await writeClipboardFromCapture(captureOnce);
          copied = result.copied === true;
          if (!copied) copyError = result.error;
        }
        let captureResult = null;
        try {
          captureResult = await captureOnce();
        } catch (captureError) {
          captureResult = null;
          if (!copied) {
            const text =
              captureError !== null && captureError !== undefined && captureError.code === 'tooLong'
                ? tooLongText(captureError)
                : translate('toast.renderFailed', { reason: truncate(errorMessage(captureError), 140) });
            showToast({ kind: 'error', text, timeoutMs: 10000 });
            flash('error', 2600);
            return;
          }
        }
        if (captureResult === null) {
          if (!copied) {
            showToast({ kind: 'error', text: translate('toast.renderFailed', { reason: 'unknown error' }), timeoutMs: 10000 });
            flash('error', 2600);
          }
          return;
        }
        const parts =
          Array.isArray(captureResult.parts) && captureResult.parts.length > 0
            ? captureResult.parts
            : [{ blob: captureResult.blob, width: captureResult.width, height: captureResult.height }];
        const partCount = parts.length;
        const downloadAllAction = {
          label: partCount > 1 ? translate('toast.downloadAll', { count: partCount }) : translate('toast.download'),
          onClick: () => {
            dismissToast();
            try {
              downloadParts(parts);
            } catch (error) {
              showToast({ kind: 'error', text: translate('toast.renderFailed', { reason: truncate(errorMessage(error), 120) }), timeoutMs: 8000 });
            }
          }
        };
        const retryAction = {
          label: translate('toast.retry'),
          onClick: () => {
            dismissToast();
            runCapture({ ...context, button, messageId, nodeKey, translate, setPhase, isAlive, flash, done });
          }
        };
        const copyPartAt = async (index) => {
          if (partCount <= 1) return;
          const safeIndex = ((index % partCount) + partCount) % partCount;
          const part = parts[safeIndex];
          try {
            if (!canWriteClipboard()) throw new Error('clipboard unavailable');
            await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': part.blob })]);
            const nextIndex = (safeIndex + 1) % partCount;
            showToast({
              kind: 'success',
              text: translate('toast.copiedPart', { index: safeIndex + 1, count: partCount, width: part.width, height: part.height }),
              timeoutMs: 4000,
              actions: [
                { label: translate('toast.copyPart', { index: nextIndex + 1 }), onClick: () => copyPartAt(nextIndex) },
                downloadAllAction
              ]
            });
            flash('success', 1800);
          } catch (error) {
            showToast({
              kind: 'error',
              text: translate('toast.copyFailed') + ' (' + truncate(errorMessage(error), 80) + ')',
              timeoutMs: 10000,
              actions: [downloadAllAction]
            });
            flash('error', 2600);
          }
        };
        let multiactions = [];
        if (partCount > 1) {
          multiactions = [
            { label: translate('toast.copyPart', { index: 2 }), onClick: () => copyPartAt(1) },
            downloadAllAction
          ];
        }
        if (copied) {
          let text;
          if (partCount > 1) {
            text = translate('toast.copiedParts', { count: partCount, width: captureResult.width, height: captureResult.height });
          } else if (captureResult.skippedImages > 0) {
            text = translate('toast.copiedSkipped', { width: captureResult.width, height: captureResult.height, count: captureResult.skippedImages });
          } else if (captureResult.scaled) {
            text = translate('toast.copiedScaled', { width: captureResult.width, height: captureResult.height });
          } else {
            text = translate('toast.copied', { width: captureResult.width, height: captureResult.height });
          }
          showToast({ kind: 'success', text, timeoutMs: partCount > 1 ? 5000 : 3200, actions: partCount > 1 ? multiactions : [] });
          flash('success', 1800);
          return;
        }
        if (!clipboardAvailable) {
          showToast({
            kind: 'error',
            text: translate('toast.clipboardUnavailable') + (partCount > 1 ? translate('toast.partCountSuffix', { count: partCount }) : ''),
            timeoutMs: 10000,
            actions: [downloadAllAction]
          });
          flash('error', 2600);
          return;
        }
        showToast({
          kind: 'error',
          text: translate('toast.copyFailed') + (copyError === null ? '' : ' (' + truncate(errorMessage(copyError), 80) + ')'),
          timeoutMs: 10000,
          actions: [retryAction, downloadAllAction]
        });
        flash('error', 2600);
      } catch (error) {
        const text =
          error !== null && error !== undefined && error.code === 'tooLong'
            ? tooLongText(error)
            : translate('toast.renderFailed', { reason: truncate(errorMessage(error), 140) });
        showToast({ kind: 'error', text, timeoutMs: 10000 });
        flash('error', 2600);
      } finally {
        clearProgress();
        try {
          done();
        } catch {
          // ignore
        }
      }
    }

    //#endregion

    //#region toast component

    function ShareImageToast(props) {
      const toast = React.useSyncExternalStore(subscribeToast, getToastSnapshot, getToastSnapshot);
      const translate = typeof props.t === 'function' ? props.t : (key) => key;
      if (toast === null) return null;
      const actions = Array.isArray(toast.actions) ? toast.actions : [];
      return h(
        'div',
        {
          className: PREFIX + '-toast',
          'data-kind': toast.kind,
          role: 'status',
          'aria-live': 'polite'
        },
        h('span', { className: PREFIX + '-toast-icon', 'aria-hidden': true }, toastIcon(toast.kind)),
        h('span', { className: PREFIX + '-toast-text' }, toast.text),
        actions.map((action, index) =>
          h(
            'button',
            {
              key: 'action-' + index,
              type: 'button',
              className: PREFIX + '-toast-btn',
              onClick: () => {
                try {
                  action.onClick();
                } catch {
                  dismissToast();
                }
              }
            },
            action.label
          )
        ),
        h(
          'button',
          {
            type: 'button',
            className: PREFIX + '-toast-close',
            'aria-label': translate('toast.dismiss'),
            title: translate('toast.dismiss'),
            onClick: () => dismissToast()
          },
          '×'
        )
      );
    }

    function ShareImageToastEntry(props) {
      return h(ShareImageBoundary, null, h(ShareImageToast, props));
    }

    //#endregion

    //#region plugin body

    function apply(ctx) {
      ensureStyles();
      ctx.effect(() => () => removeStyles(), 'dsh-chat-share-image styles');
      ctx.effect(() => () => {
        clearToastTimer();
        toastValue = null;
      }, 'dsh-chat-share-image toast timer');
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-chat-share-image locale');

      ctx.slots.inject('conversation.chat.assistant-actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.assistant-actions',
            id: ACTION_ID,
            order: 15,
            locale: NS
          },
          ShareImageAction
        )
      );

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: TOAST_ID,
            order: 1000,
            locale: NS
          },
          ShareImageToastEntry
        )
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply
    };
  }
});
