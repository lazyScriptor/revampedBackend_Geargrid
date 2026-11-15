# Settings to make adjustable later

Values that are fixed in code today but that the shop owner wants changeable from the super admin
console, per shop. Each one is marked in code with a `FUTURE (super admin setting)` comment, so
`grep -rn "FUTURE (super admin setting)"` across `revampedBackend_Geargrid` and `revampedFrontend`
finds them.

| Setting | Fixed value | Where it lives | What it does |
| :--- | :--- | :--- | :--- |
| Digits before phone contacts show | `9` | `MIN_CONTACT_SEARCH_DIGITS` in `src/services/phoneContactService.js` (enforced by the API) and in `revampedFrontend/src/lib/phoneSearch.ts` (hides the POS lookup and shows the hint) | Synced phone contacts appear in the POS customer search only after this many digits are typed, so staff cannot browse the shop's contacts with a few numbers. Customer search itself still starts at 3 digits. |
| Android app minimum & latest versions | `1.0.0` (seeded in master DB `PLATFORM_CONFIG`) | `DEFAULT_MIN_APP_VERSION`, `DEFAULT_LATEST_APP_VERSION`, and `getAppVersionConfig` in `src/services/deviceService.js` | Exposed via `GET /api/device/policy` and `GET /api/phone-assistant/devices` so phones older than `min_app_version` are blocked with "Update required", phones older than `latest_app_version` show "Update available", and Device Console flags outdated phones. |
| Call screen text sizes and card height cap | sizes in `shared/geargrid-contracts/src/callScreenTokens.json`; cap `70` percent of screen height | `callScreenTokens.json` (copied into the web app and the Android project) | Release 3 offers four sizes (compact to extra large) and keeps the call card under 70 % of the screen. The owner may want to tune the point sizes or the cap per shop; today they are fixed for every shop. |
| Notification languages offered | `en`, `si`, `ta`, `si-Latn` | `src/config/pushLanguages.js` | Adding a language is a catalog entry plus default templates. A super admin screen could switch languages on or off per shop; today a shop narrows the list itself with `notifications.allowed_languages`. |
| Notification format options | currency `LKR` / `Rs.` / `රු.`; date `yyyy-mm-dd` / `dd MMM` / `dd/mm`; time `24h` / `12h`; digits `latin` | `src/services/pushTemplateService.js`, policy `notifications.format` | `digits` is fixed to `latin` and listed so it is explicit. Sinhala or Tamil numerals could be offered later. |

## When building the super admin control

- Store the search-digit value per shop with the other phone assistant settings (`TenantConfig.custom_settings.phone_assistant`), editable in the super admin console next to the `phone_assistant` plan switch.
- Store `min_app_version` and `latest_app_version` globally in master DB `PLATFORM_CONFIG`, editable from a platform settings panel in the super admin console.
- Have the API read it in `searchPhoneContacts` instead of the constant, and send it to the web app (for example in `GET /api/phone-assistant/push-settings` or the plan/features payload) so the POS hint and lookup use the same number.
- Keep 9 as the default when a shop has no value saved, and refuse values below 3.
