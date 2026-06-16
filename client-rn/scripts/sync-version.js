#!/usr/bin/env node
/**
 * sync-version.js — propagates the version field from package.json to:
 *   - AssistantPro/android/app/build.gradle  → versionName
 *   - AssistantPro/ios/AssistantPro.xcodeproj/project.pbxproj  → MARKETING_VERSION
 *
 * Run after bumping package.json version:
 *   npm run sync-version
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

// ── Android ──────────────────────────────────────────────────────────────────
const gradlePath = resolve(root, 'AssistantPro/android/app/build.gradle');
const gradle = readFileSync(gradlePath, 'utf8');
const updatedGradle = gradle.replace(
  /versionName\s+"[^"]+"/,
  `versionName "${version}"`,
);
writeFileSync(gradlePath, updatedGradle);
console.log(`✓ Android build.gradle  → versionName "${version}"`);

// ── iOS ───────────────────────────────────────────────────────────────────────
const pbxprojPath = resolve(
  root,
  'AssistantPro/ios/AssistantPro.xcodeproj/project.pbxproj',
);
const pbxproj = readFileSync(pbxprojPath, 'utf8');
const updatedPbxproj = pbxproj.replace(
  /MARKETING_VERSION = [^;]+;/g,
  `MARKETING_VERSION = ${version};`,
);
writeFileSync(pbxprojPath, updatedPbxproj);
console.log(`✓ iOS project.pbxproj   → MARKETING_VERSION = ${version}`);

console.log(`\nAll platforms are now at v${version}`);
