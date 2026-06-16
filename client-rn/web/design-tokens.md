# Web Design Tokens

Extracted from `web/styles.css` and the pass-1 section split (`HeaderSection`, `PremiumGateSection`, `VoiceStageSection`, `UsageSection`, `BottomNavSection`, overlays).

**Purpose:** use this as the visual handoff for implementing the same design in `client-rn/src`.

---

## 1. Visual style summary

- **Theme:** dark, futuristic, voice-assistant UI
- **Primary accent:** electric cyan
- **Secondary accent:** magenta for speaking / premium moments
- **Surface treatment:** glassy dark panels with low-opacity cyan borders
- **Shape language:** rounded pills, soft cards, circular orb controls
- **Depth:** blur + glow rather than hard shadows

---

## 2. Core color tokens

| Token | Value | Use |
|---|---:|---|
| `color.bg.base` | `#0A0F1C` | app background |
| `color.bg.panel` | `#0D1424` | default dark surface |
| `color.brand.cyan` | `#00E5FF` | primary action, highlights, icons |
| `color.brand.cyanSoft` | `#81ECFF` | headings, premium glow, secondary accent |
| `color.brand.magenta` | `#B400FF` | speaking/pro gradient accent |
| `color.text.primary` | `#EDF4FF` | primary text |
| `color.text.muted` | `rgba(237, 244, 255, 0.45)` | supporting copy |
| `color.feedback.error` | `#FF3B30` | error states |

### Supporting surface colors

| Token | Value | Use |
|---|---:|---|
| `color.surface.headerStart` | `#0A1F33` | top header gradient start |
| `color.surface.headerEnd` | `#040F19` | top header gradient end |
| `color.surface.avatar` | `rgba(18, 33, 46, 0.88)` | avatar / icon chip background |
| `color.surface.cyanTintSoft` | `rgba(0, 229, 255, 0.06)` | subtle filled control surface |
| `color.surface.cyanTintMid` | `rgba(0, 229, 255, 0.10)` | hover / emphasized chip |
| `color.surface.cyanTintStrong` | `rgba(0, 229, 255, 0.16)` | active pill / CTA accents |
| `color.border.cyanSoft` | `rgba(129, 236, 255, 0.06)` | subtle dividers |
| `color.border.cyan` | `rgba(0, 229, 255, 0.25)` | default control border |
| `color.border.cyanStrong` | `rgba(0, 229, 255, 0.34)` | active/highlight border |

---

## 3. Background + glow tokens

| Token | Value | Use |
|---|---|---|
| `fx.gridDots` | `radial-gradient(circle, rgba(0,229,255,0.065) 1px, transparent 1px)` | app grid texture |
| `fx.glow.cyanAmbient` | `radial-gradient(ellipse 60% 80% at 28% 52%, rgba(0,229,255,0.13), transparent)` | left-side cyan bloom |
| `fx.glow.magentaAmbient` | `radial-gradient(ellipse 56% 80% at 72% 52%, rgba(180,0,255,0.11), transparent)` | right-side magenta bloom |
| `fx.glow.orb` | `0 0 60px 10px rgba(0, 227, 253, 0.3)` | main orb halo |
| `fx.glow.softCyan` | `0 0 10px rgba(129, 236, 255, 0.15)` | icon chips / avatar |
| `fx.glow.header` | `0 10px 40px rgba(0, 229, 255, 0.08)` | top bar elevation |

**RN note:** replace `backdrop-filter` and heavy CSS glow with `shadowColor`, `shadowOpacity`, `shadowRadius`, and Android `elevation` approximations.

---

## 4. Typography tokens

### Font families

| Token | Value | Use |
|---|---|---|
| `font.family.base` | `"Space Grotesk", "Avenir Next", "Segoe UI", sans-serif` | primary UI |
| `font.family.label` | `"Manrope", "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif` | premium pill / micro labels |

### Recommended type scale

| Token | Web value basis | RN target |
|---|---:|---:|
| `font.size.micro` | `8.5px`–`10px` | `9`–`10` |
| `font.size.xs` | `0.58rem`–`0.68rem` | `10`–`11` |
| `font.size.sm` | `0.78rem`–`0.95rem` | `12`–`14` |
| `font.size.body` | `1rem` | `16` |
| `font.size.sectionTitle` | `1.1rem`–`1.35rem` | `18`–`22` |
| `font.size.hero` | `clamp(2rem, 4.2vw, 2.5rem)` | `32`–`40` |
| `font.size.display` | `3rem`–`3.2rem` | `44`–`52` |

### Letter spacing rules

| Token | Value | Use |
|---|---:|---|
| `font.tracking.tight` | `-0.02em` to `-0.01em` | hero/display headings |
| `font.tracking.brand` | `0.08em` | app title |
| `font.tracking.label` | `0.12em`–`0.16em` | pills, caps labels |
| `font.tracking.micro` | `0.20em`–`0.30em` | tiny badges |

**Style rule:** headings are bright cyan or white-cyan; micro labels are uppercase with wide tracking.

---

## 5. Spacing scale

This stylesheet uses many nearby values; normalize them to the following scale for `src`:

| Token | Value |
|---|---:|
| `space.1` | `4px` |
| `space.2` | `6px` |
| `space.3` | `8px` |
| `space.4` | `10px` |
| `space.5` | `12px` |
| `space.6` | `14px` |
| `space.7` | `16px` |
| `space.8` | `20px` |
| `space.9` | `24px` |
| `space.10` | `28px` |
| `space.11` | `32px` |
| `space.12` | `40px` |

### Common layout references

| Usage | Current web value |
|---|---:|
| header horizontal padding | `22px` |
| main voice area padding | `26px 24px 118px` |
| card/panel padding | `22px 20px`, `22px 24px`, `24px` |
| bottom sheet / modal padding | `24px 24px 48px` |
| bottom nav area padding | `12px 12px 28px` |

---

## 6. Radius tokens

| Token | Value | Use |
|---|---:|---|
| `radius.round` | `50%` | circular elements |
| `radius.pill` | `999px` / `9999px` | buttons, pills, chips |
| `radius.sm` | `10px` | menu buttons, compact actions |
| `radius.md` | `12px` | cards, small panels |
| `radius.lg` | `14px` | premium gate, usage card |
| `radius.xl` | `20px` | major content panels |
| `radius.hero` | `2rem` | large login / hero surfaces |

---

## 7. Component-specific style guide

### `HeaderSection`
- Fixed top bar with dark gradient: `#0A1F33 → #040F19`
- Height: `64px`
- Uses cyan glow border and soft blur
- Avatar and menu button use rounded, low-opacity cyan shells

### `PremiumGateSection`
- Glass card surface
- Rounded `14px`
- Cyan border, cyan-soft text, muted support text
- CTA is a pill with stronger cyan tint

### `VoiceStageSection`
- Central hero interaction area
- Main orb = circle + cyan glow + subtle animated aura
- State colors:
  - listening = cyan
  - processing = cyan
  - speaking = magenta accent
  - error = red copy on dark card

### `UsageSection`
- Small glass card with progress bar
- Uses micro labels and muted text
- Progress fill is cyan

### `BottomNavSection`
- Fixed bottom shell with subtle top border
- Compact icon + label stack
- Active state uses brighter cyan emphasis

### Overlays (`SettingsOverlay`, `LoginOverlay`, `UpgradePanel`)
- Full-screen or high-emphasis modal presentation
- Dark surfaces with cyan borders and glows
- Maintain rounded corners and generous padding

---

## 8. Motion + interaction cues

| Token | Pattern |
|---|---|
| `motion.orbSpin` | slow infinite rotation for outer orb ring |
| `motion.waveform` | staggered waveform bars during listening |
| `motion.progress` | smooth fill while speaking |
| `motion.hoverGlow` | border/glow intensifies on active state |

**Implementation note for RN:** keep motion minimal and smooth; use `react-native-reanimated` for the orb pulse, waveform, and progress fill.

---

## 9. Suggested RN token object

```ts
export const tokens = {
  colors: {
    bgBase: '#0A0F1C',
    bgPanel: '#0D1424',
    cyan: '#00E5FF',
    cyanSoft: '#81ECFF',
    magenta: '#B400FF',
    text: '#EDF4FF',
    textMuted: 'rgba(237, 244, 255, 0.45)',
    error: '#FF3B30',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: {
    sm: 10,
    md: 12,
    lg: 14,
    xl: 20,
    pill: 999,
  },
};
```

---

## 10. Porting rule for `src`

When rebuilding in React Native:

1. **Keep the visual hierarchy** from the section components
2. **Use these normalized tokens**, not one-off CSS values
3. **Prefer consistency over exact browser parity**
4. **Approximate blur/glass/glow**, do not try to clone browser CSS exactly

> Source of truth for layout structure: `web/components/*`
>
> Source of truth for visuals: this file + `web/styles.css`

---

## 11. RN implementation status (`src`) — 2026-04-06

### Implemented now

The following web-inspired UI work has already been ported into `client-rn/src`:

- `src/theme/tokens.ts`
  - initial RN token set created from this handoff doc
  - includes colors, spacing, radius, and shadow/glow approximations

- `src/screens/HomeScreen.tsx`
  - **header shell** updated to better match the web look
  - **premium gate** styling aligned more closely with `web`
  - **voice stage** reworked into clearer states:
    - idle orb
    - listening panel
    - processing panel
    - speaking panel with progress bar
  - **usage card** updated to use the new visual language
  - **bottom nav shell** styled closer to the web layout

- `src/components/WaveformAnimator.tsx`
  - waveform bars updated to better match the cyan animated style from `web`

### Partially implemented / approximate only

These are intentionally **close approximations**, not exact browser clones:

- glow and blur treatment
- orb aura / atmospheric background feel
- progress and panel micro-interactions
- exact spacing and scale tuning across devices

### Not implemented yet

The following parts of the web design are **not fully ported yet** into RN:

- exact icon system parity with `web/components/icons.tsx`
- full visual parity for overlays / flows such as:
  - settings presentation
  - upgrade presentation
  - login presentation
- exact web-style gradients, dashed orbital motion, and glass effects
- screen-by-screen parity outside `HomeScreen`
- final simulator/device tuning pass for spacing, shadows, and animations

### Current expectation

At this stage, `src` has a **first-pass high-fidelity port** of the core home UI, but it still needs:

1. visual QA on simulator/device
2. iteration for tighter parity
3. porting of remaining screens and overlays

### Recommended next steps

- validate `HomeScreen` on iOS and Android
- tune spacing and glow intensity per device
- port `Settings`, `Upgrade`, and related overlays next
- replace temporary text glyph icons with a consistent RN icon strategy if needed
