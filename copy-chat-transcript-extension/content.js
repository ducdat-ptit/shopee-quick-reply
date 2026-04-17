(function () {
  "use strict";

  const isShopeeVn =
    location.hostname === "shopee.vn" || location.hostname.endsWith(".shopee.vn");

  if (!isShopeeVn) {
    return;
  }

  const SELECTORS = {
    chatRoot: "#fake-module-chat",
    messagesContainer: "#messagesContainer",
    messageSection: "#messageSection",
    messageRow: ".lZX8jHufoA",
    buyerMarker: ".qAGJYsVJQu",
    sellerMarker: ".n7tPV8kPwM",
    sellerRow: ".WTt5Zxu_wD",
    textNode: ".w2C67vtnXi",
    activePane: ".WGDkm_RPQw",
    activeBuyerName: ".WGDkm_RPQw .lyWL3rDmij",
    selectedConversationName: ".VYMhUHToKy .AgkH0mKhkS[title]",
    timestamp: ".sSIhmxFOh6, .oZpJocS6JM, .qwwbmNEhMY, .pE0ax8leZo",
    readStatus: ".ChatbotUI-messagereadstatus-root",
    icon: "svg, i",
    stickerContainer: ".BFp1MV57hw",
    stickerImage: ".BFp1MV57hw img, img.y8GQiaL4DE"
  };

  const EXCLUDED_INSIDE_ROW = [
    ".K16n7hSTZs", // order detail card inside a timeline row
    ".P8CcB0wjwY", // product card sent in chat
    ".SGN4jJhn6Z",
    ".D7l5Vvsvcp", // order discussion banner
    ".i6xFxbUJy0", // Shopee safety/system notice
    ".ufjjFujTb2", // "sent by Chat AI" footer
    ".EW0ojkPRCP", // notice/helper content wrapper
    ".AicCHXaeWK", // non-message read/status container
    ".JFi_00oVtH" // product-card time/status footer
  ];

  const EXCLUDED_TEXT_PATTERNS = [
    /^\[?\s*Trợ lý Chat AI\s*\]?/i,
    /Được gửi bởi\s+Trợ lý Chat AI/i,
    /Shopee\s+KHÔNG\s+cho phép/i,
    /Vui lòng chỉ mua-bán trực tiếp/i,
    /Bạn đang trao đổi với Người mua về đơn hàng này/i,
    /^Sản phẩm$/i,
    /^\[Sản phẩm\]/i,
    /^\[Dán nhãn\]/i,
    /^\[Lịch sử Hỏi - Đáp\]/i
  ];

  let toastTimer = 0;
  let observer = null;
  let currentConversationKey = "";
  let firstSeenSequence = 0;
  let refreshQueued = false;
  const transcriptCache = new Map();

  function findMessageSection() {
    const root = document.querySelector(SELECTORS.chatRoot);
    if (!root) {
      return null;
    }

    const container = root.querySelector(SELECTORS.messagesContainer);
    if (!container) {
      return null;
    }

    return container.querySelector(SELECTORS.messageSection);
  }

  function findButtonHost(messageSection) {
    return messageSection.closest(SELECTORS.messagesContainer) || messageSection;
  }

  function ensurePositioning(host) {
    const style = window.getComputedStyle(host);
    if (style.position === "static") {
      host.dataset.cqtePositionPatched = "true";
      host.style.position = "relative";
    }
  }

  function injectButton() {
    const messageSection = findMessageSection();
    if (!messageSection) {
      return;
    }

    const host = findButtonHost(messageSection);
    if (!host || host.querySelector(".cqte-copy-button")) {
      return;
    }

    ensurePositioning(host);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cqte-copy-button";
    button.title = "Copy cached chat transcript";
    button.setAttribute("aria-label", "Copy cached chat transcript");
    button.addEventListener("click", handleCopyClick);

    host.appendChild(button);
  }

  async function handleCopyClick() {
    refreshConversationCache();

    const transcript = buildTranscript();
    if (!transcript) {
      showToast("Không tìm thấy nội dung chat để copy");
      return;
    }

    try {
      await copyToClipboard(transcript);
      showToast("Đã copy chat transcript");
    } catch (error) {
      console.error("[copy-chat-transcript] Clipboard copy failed", error);
      showToast("Không copy được vào clipboard");
    }
  }

  function buildTranscript() {
    return Array.from(transcriptCache.values())
      .sort(compareCachedMessages)
      .map((message) => `${message.role}: ${message.text}`)
      .join("\n");
  }

  function scheduleRefresh() {
    if (refreshQueued) {
      return;
    }

    refreshQueued = true;
    window.requestAnimationFrame(() => {
      refreshQueued = false;
      injectButton();
      refreshConversationCache();
    });
  }

  function refreshConversationCache() {
    const messageSection = findMessageSection();
    if (!messageSection) {
      return;
    }

    resetCacheIfConversationChanged();

    const rows = Array.from(messageSection.querySelectorAll(SELECTORS.messageRow));
    for (const row of rows) {
      const extracted = extractRow(row);
      if (!extracted) {
        continue;
      }

      const order = getRowOrder(row);
      const cacheKey = buildCacheKey(extracted);
      const existing = transcriptCache.get(cacheKey);
      if (existing) {
        if (Number.isFinite(order)) {
          existing.order = order;
        }
        continue;
      }

      transcriptCache.set(cacheKey, {
        role: extracted.role,
        text: extracted.text,
        timestamp: extracted.timestamp,
        order,
        firstSeen: firstSeenSequence++
      });
    }
  }

  function resetCacheIfConversationChanged() {
    const nextKey = getConversationKey();
    if (!nextKey) {
      return;
    }

    if (currentConversationKey && currentConversationKey !== nextKey) {
      transcriptCache.clear();
      firstSeenSequence = 0;
    }

    currentConversationKey = nextKey;
  }

  function getConversationKey() {
    const root = document.querySelector(SELECTORS.chatRoot);
    if (!root) {
      return "";
    }

    const activePane = root.querySelector(SELECTORS.activePane);
    const name =
      normalizeText(root.querySelector(SELECTORS.activeBuyerName)?.textContent || "") ||
      normalizeText(root.querySelector(SELECTORS.selectedConversationName)?.getAttribute("title") || "");
    const avatar = normalizeText(activePane?.querySelector(".AojcndXunE img")?.getAttribute("src") || "");

    if (!name && !avatar) {
      return "";
    }

    return `${location.pathname}|${name}|${avatar}`;
  }

  function getRowOrder(row) {
    const styleTop = Number.parseFloat(row.style.top || "");
    if (Number.isFinite(styleTop)) {
      return styleTop;
    }

    const styleAttributeTop = /(?:^|;)\s*top:\s*(-?\d+(?:\.\d+)?)px/i.exec(
      row.getAttribute("style") || ""
    );
    if (styleAttributeTop) {
      return Number.parseFloat(styleAttributeTop[1]);
    }

    const transformTop = /translateY\((-?\d+(?:\.\d+)?)px\)/i.exec(row.style.transform || "");
    return transformTop ? Number.parseFloat(transformTop[1]) : null;
  }

  function buildCacheKey(message) {
    return JSON.stringify([message.role, message.text, message.timestamp || "no-time"]);
  }

  function compareCachedMessages(left, right) {
    const leftHasOrder = Number.isFinite(left.order);
    const rightHasOrder = Number.isFinite(right.order);

    if (leftHasOrder && rightHasOrder && left.order !== right.order) {
      return left.order - right.order;
    }

    if (leftHasOrder !== rightHasOrder) {
      return leftHasOrder ? -1 : 1;
    }

    return left.firstSeen - right.firstSeen;
  }

  function extractRow(row) {
    if (isExcludedRow(row)) {
      return null;
    }

    const role = detectRole(row);
    if (!role) {
      return null;
    }

    const message = extractMessage(row);
    const text = message.text;
    if (!text || isExcludedMessageText(text)) {
      return null;
    }

    return { role, text, timestamp: message.timestamp };
  }

  function detectRole(row) {
    // In the reference DOM, customer rows contain qAGJYsVJQu. Seller rows either
    // carry WTt5Zxu_wD on the row or contain n7tPV8kPwM as the direction wrapper.
    if (row.matches(SELECTORS.sellerRow) || row.querySelector(SELECTORS.sellerMarker)) {
      return "A";
    }

    if (row.querySelector(SELECTORS.buyerMarker)) {
      return "Q";
    }

    return "";
  }

  function isExcludedRow(row) {
    if (EXCLUDED_INSIDE_ROW.some((selector) => row.querySelector(selector))) {
      return true;
    }

    const rowText = normalizeText(row.textContent || "");
    return EXCLUDED_TEXT_PATTERNS.some((pattern) => pattern.test(rowText));
  }

  function extractMessage(row) {
    const textNode = chooseTextNode(row);
    if (textNode) {
      return {
        text: normalizeText(readTextWithoutChrome(textNode)),
        timestamp: extractTimestamp(row, textNode)
      };
    }

    return {
      text: extractStickerText(row),
      timestamp: extractTimestamp(row)
    };
  }

  function chooseTextNode(row) {
    const candidates = Array.from(row.querySelectorAll(SELECTORS.textNode));
    return candidates.find((node) => {
      const text = normalizeText(readTextWithoutChrome(node));
      return text && !isExcludedMessageText(text);
    });
  }

  function readTextWithoutChrome(node) {
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll(`${SELECTORS.timestamp}, ${SELECTORS.readStatus}, ${SELECTORS.icon}`)
      .forEach((child) => child.remove());

    return clone.textContent || "";
  }

  function extractTimestamp(row, textNode) {
    const timestampNode =
      textNode?.querySelector(SELECTORS.timestamp) || row.querySelector(SELECTORS.timestamp);
    if (!timestampNode) {
      return "";
    }

    const clone = timestampNode.cloneNode(true);
    clone.querySelectorAll(`${SELECTORS.readStatus}, ${SELECTORS.icon}`).forEach((child) => {
      child.remove();
    });

    return normalizeText(clone.textContent || "");
  }

  function extractStickerText(row) {
    const sticker = row.querySelector(SELECTORS.stickerImage);
    if (!sticker || !row.querySelector(SELECTORS.stickerContainer)) {
      return "";
    }

    const label = [
      sticker.getAttribute("alt"),
      sticker.getAttribute("title"),
      sticker.getAttribute("aria-label"),
      sticker.closest("[title]")?.getAttribute("title"),
      sticker.closest("[aria-label]")?.getAttribute("aria-label")
    ]
      .map((value) => normalizeText(value || ""))
      .find((value) => value && !looksLikeUrlOrFile(value));

    return label ? `[sticker: ${label}]` : "";
  }

  function isExcludedMessageText(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return true;
    }

    return EXCLUDED_TEXT_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  function looksLikeUrlOrFile(value) {
    return /^https?:\/\//i.test(value) || /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(value);
  }

  function normalizeText(value) {
    return String(value)
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const ok = document.execCommand("copy");
      if (!ok) {
        throw new Error("document.execCommand('copy') returned false");
      }
    } finally {
      textarea.remove();
    }
  }

  function showToast(message) {
    let toast = document.querySelector(".cqte-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "cqte-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("cqte-toast--visible");

    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("cqte-toast--visible");
    }, 2200);
  }

  function setupObserver() {
    if (observer) {
      return;
    }

    observer = new MutationObserver(() => {
      scheduleRefresh();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  }

  scheduleRefresh();
  setupObserver();
})();
