# Settings to make adjustable later

Values that are fixed in code today but that the shop owner wants changeable from the super admin
console, per shop. Each one is marked in code with a `FUTURE (super admin setting)` comment, so
`grep -rn "FUTURE (super admin setting)"` across `revampedBackend_Geargrid` and `revampedFrontend`
finds them.

| Setting | Fixed value | Where it lives | What it does |
| :--- | :--- | :--- | :--- |
| Digits before phone contacts show | `9` | `MIN_CONTACT_SEARCH_DIGITS` in `src/services/phoneContactService.js` (enforced by the API) and in `revampedFrontend/src/lib/phoneSearch.ts` (hides the POS lookup and shows the hint) | Synced phone contacts appear in the POS customer search only after this many digits are typed, so staff cannot browse the shop's contacts with a few numbers. Customer search itself still starts at 3 digits. |

## When building the super admin control

- Store the value per shop with the other phone assistant settings (`TenantConfig.custom_settings.phone_assistant`), editable in the super admin console next to the `phone_assistant` plan switch.
- Have the API read it in `searchPhoneContacts` instead of the constant, and send it to the web app (for example in `GET /api/phone-assistant/push-settings` or the plan/features payload) so the POS hint and lookup use the same number.
- Keep 9 as the default when a shop has no value saved, and refuse values below 3.
