# Shopee VN Quick Reply Assistant

Chrome Extension Manifest V3 for adding quick reply suggestions beside buyer messages in Shopee Vietnam chat.

## Install

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this project folder: `D:\Tool\Extensions\PopupReply`.
5. Open a Shopee Vietnam seller chat page, for example `https://banhang.shopee.vn/`.

The extension only runs on:

- `https://shopee.vn/*`
- `https://*.shopee.vn/*`

It also checks the hostname at runtime and exits unless the host is `shopee.vn` or ends with `.shopee.vn`.

## How It Works

The extension injects `content.js` and `content.css` into Shopee Vietnam pages. The script:

1. Finds the chat root from the DOM snapshot pattern: `#fake-module-chat`.
2. Scans only the active chat area: `#messagesContainer #messageSection`.
3. Uses a `MutationObserver` to react to new virtualized chat rows. It does not use polling.
4. Detects message rows from the snapshot pattern: `.lZX8jHufoA`.
5. Detects buyer text bubbles from the structure:
   - Direction wrapper: `.qAGJYsVJQu`
   - Text bubble: `pre.FkK7VxR2qX > .w2C67vtnXi`
   - Timestamp child removed from extraction: `.sSIhmxFOh6`
6. Excludes seller and non-message blocks using snapshot-derived markers:
   - Seller wrapper/direction markers: `.WTt5Zxu_wD`, `.n7tPV8kPwM`
   - Seller read status: `.ChatbotUI-messagereadstatus-root`
   - Order cards: `.K16n7hSTZs`
   - Product cards: `.P8CcB0wjwY`
   - AI/system blocks: `.xQ_ZVDDSL5`, `.ujrf_CG21r`, `.EW0ojkPRCP`, `.ZpXLnW2Ey_`
7. Injects a small `⚡` button at the top-right of each detected buyer text bubble.
8. Opens one popup at a time with the original message and matching suggested replies.
9. Inserts the selected reply into the chat textarea derived from the snapshots: `textarea.MdXquzGuDv`.

## DOM Reference

The detection logic is based on the real snapshots in `/example_dom`:

- `div_1.txt`
- `div_2.txt`
- `div_3.txt`

Important patterns found in those files:

- Chat root: `#fake-module-chat`
- Message container: `#messagesContainer`
- Message section: `#messageSection`
- Message row: `.lZX8jHufoA`
- Buyer/customer direction: `.qAGJYsVJQu`
- Seller direction: `.n7tPV8kPwM`
- Seller row marker: `.WTt5Zxu_wD`
- Text content: `.w2C67vtnXi`
- Timestamp inside text bubble: `.sSIhmxFOh6`
- Reply textarea: `textarea.MdXquzGuDv`

Because Shopee uses obfuscated class names, the script combines these known classes with structural checks. For example, it prefers `.w2C67vtnXi`, but also has a fallback for `pre > div` text bubbles when the text class changes.

## Customize Reply Rules

Reply rules are stored in `reply-rules/` as one JSON file per topic. The topic files include common ecommerce conversations and diaper/milk shop-specific scenarios:

- General shop chat: greeting, product availability, price/promotion, voucher, order confirmation, payment/COD, shipping fee, urgent delivery, shop location and delivery estimate.
- Order handling: cancellation, delivery delay, address/phone change, return/exchange, wrong or missing item, damaged/leaking item, packaging, order weight limits, carrier/SPX/GHN issues, co-check, invoice, review feedback.
- Gift programs from real conversations: buy 2/3/4/6 packs, gifts not showing on order, gift substitutions, random gift color/model, gift shortages, balo/vali/ghe thu/xe choi/gau/khan uot/bim dem.
- Diaper consulting: size and fit, absorbency/leakage, rash/sensitive skin, pack quantity/origin/date.
- Milk and baby food consulting: age/stage, authenticity/origin, expiry date, preparation/storage, digestion/constipation, allergy/change of formula, stock preservation, baby cereal/food, diaper and milk combos.

The complete load list is maintained in `reply-rules/index.json`.

Each topic file has this shape:

```json
{
  "topic": "cancel-order",
  "keywords": ["huỷ đơn", "hủy đơn", "cancel"],
  "replies": [
    "Shop đã nhận yêu cầu huỷ đơn của bạn.",
    "Nếu đơn chưa giao vận chuyển, shop sẽ huỷ giúp bạn."
  ]
}
```

To add a new topic:

1. Create a new JSON file in `reply-rules/`, for example `payment.json`.
2. Add that filename to `reply-rules/index.json`.
3. Reload the unpacked extension in `chrome://extensions`.

To remove a topic, remove its filename from `reply-rules/index.json`. The JSON file can then be deleted if it is no longer needed.

Matching is case-insensitive and Vietnamese diacritics are normalized before matching. For example, `huỷ đơn`, `hủy đơn`, and `huy don` all match the same normalized text.

## Files

- `manifest.json`: Manifest V3 config and Shopee Vietnam domain restrictions.
- `content.js`: DOM detection, observer, icon injection, popup, keyword matching, and textarea insertion.
- `content.css`: Styles for the injected icon, popup, and reply buttons.
- `reply-rules/`: Reply topic index and per-topic reply rule JSON files.
- `README.md`: Installation and customization notes.
