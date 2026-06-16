
# client-rn — React Native (AssistantPro)

Migrated from Cocos Creator v2.4.12 to React Native (bare workflow).  
Target stores: Apple App Store · Google Play · Samsung Galaxy Store · Huawei AppGallery.

---

## Project root

```
client-rn/
├── index.tsx                          ← App entry point; initialises i18n, mounts AppNavigator
├── index.html                         ← Web entry HTML (Vite target)
├── package.json                       ← Dependencies (RN 0.75, react-navigation, reanimated, i18next, Voice, TTS …)
├── tsconfig.json                      ← TypeScript config with path aliases (@hooks, @services, …)
├── tsconfig.web.json                  ← Web-specific TypeScript config (DOM libs + Vite types)
├── vite.config.ts                     ← Vite configuration for browser development/build
├── .env.example                       ← Example Vite env vars (VITE_API_BASE_URL for web endpoint)
├── Structure.md                       ← This file
├── android/
│   └── app/
│       └── google-services.json      ← Android Firebase config (package: studio.silverleaf.carassistantpro)
└── ios/
    └── AssistantPro/
        └── GoogleService-Info.plist  ← iOS Firebase config (bundle: studio.silverleaf.carassistantpro)
```

---

## src/

```
src/
├── hooks/                            ← Business logic as React hooks (migrated from Cocos cc.Class components)
│   ├── useVoiceStateMachine.ts       ← VoiceUIStateMachine.js  — manages idle/listening/processing/speaking/error states
│   ├── usePushToTalk.ts              ← PushToTalkPipeline.js   — hold-to-record, ASR→LLM→TTS pipeline, usage guard
│   ├── useErrorRecovery.ts           ← ErrorRecoveryManager.js — error display, auto-dismiss, retry callback
│   └── useTTS.ts                     ← TTSPlaybackComponent.js — react-native-tts play/pause/stop + caption
│
├── services/                         ← Pure TypeScript modules (no React, no UI)
│   ├── usageService.ts               ← UsageLimiter.js         — daily cap (30 req), 10-min session, rate limit, AsyncStorage
│   └── orchestrationService.ts      ← RequestResponseOrchestration.js — LLM + TTS fetch pipeline with abort/timeout
│
├── i18n/                             ← Internationalisation (migrated from Localization.js window global)
│   ├── index.ts                      ← i18next initialisation; auto-detects device locale (iOS/Android NativeModules)
│   └── locales/
│       ├── en.ts                     ← English  (en-US)
│       ├── de.ts                     ← German   (de-DE)
│       ├── fr.ts                     ← French   (fr-FR)
│       ├── es.ts                     ← Spanish  (es-ES)
│       ├── it.ts                     ← Italian  (it-IT)
│       ├── tr.ts                     ← Turkish  (tr-TR)
│       └── pl.ts                     ← Polish   (pl-PL)
│
├── components/                       ← Reusable UI primitives
│   ├── WaveformAnimator.tsx          ← WaveformAnimator.js — 9-bar staggered animation via react-native-reanimated
│   └── ErrorBanner.tsx               ← Error overlay with retry / dismiss; driven by useErrorRecovery
│
├── screens/                          ← Full-screen views (one per navigation route)
│   ├── HomeScreen.tsx                ← Main voice UI: PTT button, waveform, transcript, state label, error banner
│   └── SettingsScreen.tsx            ← SettingsPanel.js — language picker (7 locales), mic permission hint
│
└── navigation/
    └── AppNavigator.tsx              ← React Navigation native-stack: Home → Settings

web/
├── components/                        ← Presentational web sections (HeaderSection, VoiceStageSection, UsageSection, overlays)
├── design-tokens.md                   ← Visual handoff doc: colors, spacing, typography, glow, RN porting notes, and implementation status
├── main.tsx                           ← Browser bootstrap (ReactDOM)
├── WebApp.tsx                         ← Web state/orchestration container for the voice experience
├── localization.ts                    ← Locale selection + persistence + translation lookup
├── usage.ts                           ← Daily limit, session timeout, rate limit, input sanitization
├── orchestration.ts                   ← /v1/chat + /v1/tts orchestration with timeout
└── styles.css                         ← Voice UI styling + waveform animation
```

> See `web/design-tokens.md` for the current RN porting status and what is already implemented in `src/`.


---

## Key dependencies

| Package | Purpose |
|---|---|
| `react-native` 0.75 | Core framework |
| `@react-navigation/native-stack` | Screen routing |
| `react-native-reanimated` | WaveformAnimator animations |
| `@react-native-community/voice` | Microphone / ASR (replaces `cc.audioEngine`) |
| `react-native-tts` | Text-to-speech playback |
| `i18next` + `react-i18next` | All 7 locales; replaces `window.Localization` |
| `@react-native-async-storage/async-storage` | Daily request cap persistence (replaces `cc.sys.localStorage`) |
| `react-native-haptic-feedback` | Haptics on PTT press |

---

## Getting started

```bash
# 1. Initialise RN project (one-time, run from car-assistant-pro/)
cd car-assistant-pro/client-rn
npx @react-native-community/cli init AssistantPro --skip-install

# 2. Install JS dependencies
npm install

# 3. iOS — link native pods (one-time, macOS only)
cd AssistantPro; npx pod-install ios

# 4. Run in development
npm run ios       # iOS Simulator
npm run android   # Android Emulator / device (Gradle auto-downloads deps on first run)
npm run web       # Web dev server (Vite)
npm run web:build # Web production build
```

## Web API configuration

The web client reads its API endpoint from `VITE_API_BASE_URL` (Vite env var).
If it is not set, it falls back to the production endpoint.

For QA, the web UI also supports a plan-mode override via `VITE_WEB_TEST_PLAN`.

- `auto`: use app default behavior (currently falls back to free-mode UI in web)
- `free`: force free-mode UI
- `pro`: force pro-mode UI

```bash
# from client-rn/
cp .env.example .env.local

# edit .env.local for local backend, for example:
VITE_API_BASE_URL=http://localhost:3000

# optional: force plan mode for UI testing
# VITE_WEB_TEST_PLAN=free
# VITE_WEB_TEST_PLAN=pro

# start web client
npm run web
```

### Android release builds

| Target store | Format | Command (run from `android/`) |
|---|---|---|
| Google Play | AAB | `./gradlew bundleRelease` |
| Samsung Galaxy Store | APK | `./gradlew assembleRelease` |
| Huawei AppGallery | APK | `./gradlew assembleRelease` |

> **Signing**: configure your keystore in `android/app/build.gradle`.  
> The existing keystore is located in `../android/keystore/` (legacy Cocos build).

### iOS release build

```bash
# Via Xcode: open ios/AssistantPro.xcworkspace → Product → Archive
# or via CLI:
xcodebuild -workspace ios/AssistantPro.xcworkspace \
           -scheme AssistantPro \
           -configuration Release \
           -archivePath build/AssistantPro.xcarchive archive
```

> **When to Clean Build Folder (⇧⌘K) in Xcode:**
>
> | Change type | Clean needed? |
> |---|---|
> | JS/TS only (`src/`, `services/`, hooks) | **No** — plain Build (⌘B) is sufficient; Metro rebundles JS automatically |
> | Native patch via patch-package (e.g. `SessionCore.mm`) | **Yes** — native code changed, Xcode must recompile |
> | New native module added / Podfile changed | **Yes** — run `pod install` first, then Clean + Build |
> | `Info.plist`, entitlements, build settings | **Yes** |
>
> Rule of thumb: if you only edited `.ts` / `.tsx` files and did not touch anything under `ios/Pods/`, `ios/AssistantPro/` native files, or `patches/`, a clean is not needed.

---

## Notes

- **Server** (`../server/`) is unchanged — same `/v1/chat` and `/v1/tts` endpoints.
- **Firebase configs** are pre-placed in their native final locations; no manual move needed after `init`.
- **Huawei AppGallery**: standard APK works; add `react-native-hms-push` only if push notifications are needed.
- The legacy Cocos client remains in `../client/` until the RN build is validated in all stores.