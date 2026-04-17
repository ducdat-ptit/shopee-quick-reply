# Shopee VN Copy Chat Transcript

Chrome Extension Manifest V3 for quickly copying a Shopee Vietnam chat transcript into plain Q/A text for dataset building.

## Install

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

   ```text
   copy-chat-transcript-extension
   ```

## Domain Scope

The extension runs only on Shopee Vietnam domains:

```text
https://shopee.vn/*
https://*.shopee.vn/*
```

It does not use `<all_urls>`. The content script also has a runtime hostname guard:

```js
location.hostname === "shopee.vn" || location.hostname.endsWith(".shopee.vn")
```

## DOM References

The implementation was built from the real DOM snapshots in the parent project:

```text
/example_dom/div_1.txt
/example_dom/div_2.txt
/example_dom/div_3.txt
```

Those files show the active chat under:

```text
#fake-module-chat
#messagesContainer
#messageSection
```

The left conversation list also contains message previews, so the extractor only scans message rows inside `#messageSection`.

## How Extraction Works

Click the floating copy button in the top-right corner of the active conversation area.

Shopee chat uses a virtualized message list. When you scroll far up or down, Shopee may remove messages outside the current render window from the DOM. To handle that, the extension keeps an in-page session cache:

- each time Shopee renders a message row, the extension extracts and remembers it
- when you click copy, the extension outputs all cached messages for the current conversation
- cached rows are sorted by the row `top` position used by Shopee's virtualized timeline
- duplicate rows from re-rendering are ignored by using `role + normalized text + timestamp` as the stable message key

This still only uses DOM content that Shopee has rendered while you were viewing the conversation. It does not auto-scroll and does not call Shopee APIs.

The script reads currently loaded DOM rows matching the observed message row structure:

```text
.lZX8jHufoA
```

It detects message direction using the observed Shopee classes and structural wrappers:

```text
customer/buyer: .qAGJYsVJQu -> Q:
seller/shop: .WTt5Zxu_wD or .n7tPV8kPwM -> A:
```

For text messages it reads:

```text
.w2C67vtnXi
```

Then it removes timestamp/read-status children such as:

```text
.sSIhmxFOh6
.oZpJocS6JM
.ChatbotUI-messagereadstatus-root
```

Whitespace is normalized so each real message becomes one clean line.

## Conversation Cache Reset

The cache resets automatically when the active conversation changes. The reset fingerprint is based on the active right-pane buyer name/avatar observed in the Shopee chat DOM, with a fallback to the selected conversation name from the sidebar.

Typical workflow:

1. Open one conversation.
2. Scroll through the parts you want to include.
3. Click the floating copy button.
4. Switch to another conversation; the previous cache is cleared automatically.

## Excluded Blocks

The extractor skips non-chat UI blocks seen in the snapshots, including:

- Shopee safety/system notices
- AI/helper messages and rows marked as sent by Chat AI
- order cards and order discussion cards
- product cards
- read/status markers
- empty rows
- sidebar conversation previews

Sticker/image-only messages are included only when a readable `alt`, `title`, or `aria-label` exists. If no reliable meaning exists in the DOM, the sticker/image message is skipped.

## Output Format

The copied text uses this exact mapping:

```text
Q: customer message
A: seller message
```

Example:

```text
Q: sao lâu quá vậy shop ơi
Q: hết bọt cho bé ăn rồi
A: dạ shop kiểm tra giúp mình ạ
Q: mình muốn huỷ đơn
A: dạ nếu đơn chưa bàn giao vận chuyển thì shop hỗ trợ
```

Consecutive messages from the same side are not merged.

## Limitations

- Only messages rendered into the DOM during the current conversation session are copied.
- The extension does not auto-scroll.
- The extension does not fetch older messages from Shopee APIs or network requests.
- To include older messages, manually scroll up in Shopee chat first, then click the copy button.
- Reloading the page clears the in-memory cache.
