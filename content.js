(() => {
  "use strict";

  const ALLOWED_ROOT_DOMAIN = "shopee.vn";
  const PROCESSED_ATTR = "quickReplyProcessed";
  const SIGNATURE_ATTR = "quickReplySignature";
  const BUTTON_CLASS = "qra-message-button";
  const POPUP_CLASS = "qra-popup";
  const POPUP_ID = "qra-suggestion-popup";
  const SCAN_DEBOUNCE_MS = 120;
  const KIND_ATTR = "quickReplyKind";
  const REPLY_RULES_INDEX_PATH = "reply-rules/index.json";

  let compiledRules = [];
  let scanTimer = 0;
  let chatObserver = null;
  let bootstrapObserver = null;

  if (!isAllowedShopeeHost(location.hostname)) {
    return;
  }

  bootstrap();
  loadReplyRules();

  function isAllowedShopeeHost(hostname) {
    return hostname === ALLOWED_ROOT_DOMAIN || hostname.endsWith(`.${ALLOWED_ROOT_DOMAIN}`);
  }

  function loadReplyRules() {
    fetchExtensionJson(REPLY_RULES_INDEX_PATH)
      .then((index) => {
        const files = Array.isArray(index.files) ? index.files : [];

        return Promise.all(files.map((file) => fetchExtensionJson(`reply-rules/${file}`)));
      })
      .then((rules) => {
        compiledRules = rules.filter(isValidReplyRule).map((rule) => ({
          keywords: rule.keywords.map(normalizeForMatch),
          replies: rule.replies
        }));
      })
      .catch((error) => {
        console.error("Quick Reply Assistant could not load reply rules.", error);
      });
  }

  function fetchExtensionJson(path) {
    return fetch(chrome.runtime.getURL(path)).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load ${path}: ${response.status}`);
      }

      return response.json();
    });
  }

  function isValidReplyRule(rule) {
    return (
      rule &&
      Array.isArray(rule.keywords) &&
      rule.keywords.every((keyword) => typeof keyword === "string") &&
      Array.isArray(rule.replies) &&
      rule.replies.every((reply) => typeof reply === "string")
    );
  }

  function bootstrap() {
    const chatRoot = findChatRoot();
    if (chatRoot) {
      connectChatObserver(chatRoot);
      scheduleScan(chatRoot);
      return;
    }

    bootstrapObserver = new MutationObserver(() => {
      const root = findChatRoot();
      if (!root) {
        return;
      }

      bootstrapObserver.disconnect();
      bootstrapObserver = null;
      connectChatObserver(root);
      scheduleScan(root);
    });

    bootstrapObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function findChatRoot() {
    return document.querySelector("#fake-module-chat");
  }

  function connectChatObserver(chatRoot) {
    if (chatObserver) {
      chatObserver.disconnect();
    }

    chatObserver = new MutationObserver(() => scheduleScan(chatRoot));
    chatObserver.observe(chatRoot, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function scheduleScan(chatRoot = findChatRoot()) {
    if (!chatRoot) {
      return;
    }

    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => scanCustomerMessages(chatRoot), SCAN_DEBOUNCE_MS);
  }

  function scanCustomerMessages(chatRoot) {
    const messageSection = findMessageSection(chatRoot);
    if (!messageSection) {
      return;
    }

    // Derived from /example_dom: each virtualized message row has lZX8jHufoA.
    const rows = messageSection.querySelectorAll(".lZX8jHufoA");
    rows.forEach(processMessageRow);
  }

  function findMessageSection(chatRoot) {
    return (
      chatRoot.querySelector("#messagesContainer #messageSection") ||
      chatRoot.querySelector("#messageSection") ||
      chatRoot.querySelector("#messagesContainer")
    );
  }

  function processMessageRow(row) {
    const textElement = findMessageTextElement(row);
    const signature = buildRowSignature(row, textElement);

    if (
      row.dataset[PROCESSED_ATTR] === "true" &&
      row.dataset[SIGNATURE_ATTR] === signature &&
      (row.dataset[KIND_ATTR] === "ignored" || row.querySelector(`.${BUTTON_CLASS}`))
    ) {
      return;
    }

    removeInjectedButton(row);
    row.dataset[PROCESSED_ATTR] = "true";
    row.dataset[SIGNATURE_ATTR] = signature;
    row.dataset[KIND_ATTR] = "ignored";

    if (!textElement || !isCustomerTextMessage(row, textElement)) {
      return;
    }

    const messageText = extractMessageText(textElement);
    if (!messageText) {
      return;
    }

    row.dataset[KIND_ATTR] = "customer";
    injectReplyButton(row, textElement, messageText);
  }

  function buildRowSignature(row, textElement) {
    const text = textElement ? extractMessageText(textElement) : "";
    const className = row.className || "";
    const position = row.getAttribute("style") || "";

    return `${className}|${position}|${text}`;
  }

  function findMessageTextElement(row) {
    const preferred = Array.from(row.querySelectorAll(".w2C67vtnXi")).find((element) =>
      looksLikeTextBubble(element)
    );

    if (preferred) {
      return preferred;
    }

    // Structural fallback for class-name churn: text bubbles in the snapshots are
    // rendered as pre.FkK7VxR2qX > div, with the timestamp nested inside the div.
    return Array.from(row.querySelectorAll("pre > div")).find((element) => looksLikeTextBubble(element)) || null;
  }

  function looksLikeTextBubble(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const pre = element.closest("pre");
    if (!pre) {
      return false;
    }

    if (element.querySelector("img, video, canvas")) {
      return false;
    }

    return extractMessageText(element).length > 0;
  }

  function isCustomerTextMessage(row, textElement) {
    if (hasSellerMarker(row, textElement)) {
      return false;
    }

    if (hasNonMessageMarker(row)) {
      return false;
    }

    const messageText = extractMessageText(textElement);
    if (!messageText || isSystemOrAiText(messageText)) {
      return false;
    }

    // Derived from /example_dom: buyer/customer rows use qAGJYsVJQu, while seller
    // rows use n7tPV8kPwM and often WTt5Zxu_wD on the lZX8jHufoA wrapper.
    const customerDirectionalNode = textElement.closest(".qAGJYsVJQu");
    if (customerDirectionalNode) {
      return true;
    }

    // Fallback when the directional class changes: accept a plain pre text bubble
    // only after seller/system/card exclusions above have passed.
    return Boolean(textElement.closest("pre"));
  }

  function hasSellerMarker(row, textElement) {
    const rowClasses = row.classList;
    const bubble = textElement.closest("pre");

    return (
      rowClasses.contains("WTt5Zxu_wD") ||
      Boolean(row.querySelector(".n7tPV8kPwM")) ||
      Boolean(textElement.closest(".n7tPV8kPwM")) ||
      Boolean(row.querySelector(".ChatbotUI-messagereadstatus-root")) ||
      Boolean(bubble && bubble.classList.contains("K7slEK88YC"))
    );
  }

  function hasNonMessageMarker(row) {
    return Boolean(
      row.querySelector(
        [
          ".K16n7hSTZs", // order card in div_2/div_3
          ".P8CcB0wjwY", // product card in div_1
          ".xQ_ZVDDSL5", // AI/question block wrapper in div_1
          ".ujrf_CG21r", // "sent by Chat AI" metadata in div_1
          ".EW0ojkPRCP", // warning/system block in div_2
          ".ZpXLnW2Ey_" // warning/system block body in div_2
        ].join(",")
      )
    );
  }

  function isSystemOrAiText(text) {
    const normalized = normalizeForMatch(text);
    const blockedPhrases = [
      "tro ly chat ai",
      "tro ly hoi dap",
      "shopee khong cho phep",
      "vui long chi mua ban",
      "ban dang trao doi voi nguoi mua ve don hang nay",
      "id don hang",
      "ngay dat hang"
    ];

    return blockedPhrases.some((phrase) => normalized.includes(phrase));
  }

  function injectReplyButton(row, textElement, messageText) {
    const host = findButtonHost(textElement);
    if (!host) {
      return;
    }

    if (getComputedStyle(host).position === "static") {
      host.style.position = "relative";
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.textContent = "⚡";
    button.title = "Suggested replies";
    button.setAttribute("aria-label", "Show suggested replies");

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      showSuggestionsPopup(button, messageText);
    });

    host.appendChild(button);
    row.dataset[PROCESSED_ATTR] = "true";
  }

  function findButtonHost(textElement) {
    return textElement.closest("pre") || textElement;
  }

  function removeInjectedButton(row) {
    row.querySelectorAll(`.${BUTTON_CLASS}`).forEach((button) => button.remove());
  }

  function extractMessageText(textElement) {
    const clone = textElement.cloneNode(true);
    clone
      .querySelectorAll(
        [
          ".sSIhmxFOh6", // timestamp inside text message in div_1/div_2/div_3
          ".pE0ax8leZo", // AI timestamp in div_1
          ".qra-message-button",
          ".ChatbotUI-messagereadstatus-root"
        ].join(",")
      )
      .forEach((node) => node.remove());

    return normalizeWhitespace(clone.textContent || "");
  }

  function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function normalizeForMatch(value) {
    return normalizeWhitespace(value)
      .toLowerCase()
      .replace(/[đĐ]/g, "d")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function matchReplies(messageText) {
    const normalizedMessage = normalizeForMatch(messageText);
    const replies = [];

    compiledRules.forEach((rule) => {
      if (rule.keywords.some((keyword) => normalizedMessage.includes(keyword))) {
        replies.push(...rule.replies);
      }
    });

    return Array.from(new Set(replies));
  }

  function showSuggestionsPopup(anchor, messageText) {
    closePopup();

    const popup = document.createElement("div");
    popup.id = POPUP_ID;
    popup.className = POPUP_CLASS;
    popup.addEventListener("click", (event) => event.stopPropagation());

    const title = document.createElement("div");
    title.className = "qra-popup-title";
    title.textContent = "Suggested Replies";

    const originalLabel = document.createElement("div");
    originalLabel.className = "qra-original-label";
    originalLabel.textContent = "Original message";

    const original = document.createElement("div");
    original.className = "qra-original-message";
    original.textContent = messageText;

    const repliesContainer = document.createElement("div");
    repliesContainer.className = "qra-replies";

    const replies = matchReplies(messageText);
    if (replies.length === 0) {
      const empty = document.createElement("div");
      empty.className = "qra-empty";
      empty.textContent = "No matching replies found.";
      repliesContainer.appendChild(empty);
    } else {
      replies.forEach((reply) => {
        const replyButton = document.createElement("button");
        replyButton.type = "button";
        replyButton.className = "qra-reply-button";
        replyButton.textContent = reply;
        replyButton.addEventListener("click", () => {
          insertReplyIntoTextarea(reply);
          closePopup();
        });
        repliesContainer.appendChild(replyButton);
      });
    }

    popup.append(title, originalLabel, original, repliesContainer);
    document.body.appendChild(popup);
    positionPopup(anchor, popup);

    window.setTimeout(() => {
      document.addEventListener("click", handleOutsideClick, { capture: true });
      document.addEventListener("keydown", handleEscape, { capture: true });
      window.addEventListener("resize", closePopup, { once: true });
      window.addEventListener("scroll", closePopup, { once: true, capture: true });
    }, 0);
  }

  function positionPopup(anchor, popup) {
    const anchorRect = anchor.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;

    let top = anchorRect.bottom + margin;
    let left = anchorRect.right - popupRect.width;

    if (left < margin) {
      left = margin;
    }

    if (left + popupRect.width > viewportWidth - margin) {
      left = viewportWidth - popupRect.width - margin;
    }

    if (top + popupRect.height > viewportHeight - margin) {
      top = Math.max(margin, anchorRect.top - popupRect.height - margin);
    }

    popup.style.top = `${Math.round(top)}px`;
    popup.style.left = `${Math.round(left)}px`;
  }

  function handleOutsideClick(event) {
    const popup = document.getElementById(POPUP_ID);
    if (!popup || popup.contains(event.target) || event.target.closest(`.${BUTTON_CLASS}`)) {
      return;
    }

    closePopup();
  }

  function handleEscape(event) {
    if (event.key === "Escape") {
      closePopup();
    }
  }

  function closePopup() {
    const popup = document.getElementById(POPUP_ID);
    if (popup) {
      popup.remove();
    }

    document.removeEventListener("click", handleOutsideClick, { capture: true });
    document.removeEventListener("keydown", handleEscape, { capture: true });
  }

  function insertReplyIntoTextarea(reply) {
    const textarea = findReplyTextarea();
    if (!textarea) {
      return;
    }

    textarea.focus();

    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) {
      setter.call(textarea, reply);
    } else {
      textarea.value = reply;
    }

    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: reply }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findReplyTextarea() {
    const chatRoot = findChatRoot();
    const candidates = Array.from(
      (chatRoot || document).querySelectorAll(
        [
          "textarea.MdXquzGuDv", // exact textarea class from /example_dom
          "textarea[placeholder*='Nhập nội dung']",
          "textarea[placeholder*='tin nhắn']",
          "textarea"
        ].join(",")
      )
    );

    return candidates.find(isUsableTextarea) || null;
  }

  function isUsableTextarea(textarea) {
    const rect = textarea.getBoundingClientRect();
    const style = getComputedStyle(textarea);

    return (
      !textarea.disabled &&
      !textarea.readOnly &&
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }
})();
