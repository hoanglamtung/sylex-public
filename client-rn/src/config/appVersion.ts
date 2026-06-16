/**
 * Single source of truth for the current app version.
 *
 * This value is derived directly from package.json — no manual update needed here.
 * To release a new version:
 *   1. Bump `version` in package.json (or run `npm version patch|minor|major`)
 *   2. Run `npm run sync-version` to propagate to Android build.gradle + iOS project.pbxproj
 */
import pkg from '../../package.json';
export const APP_VERSION: string = pkg.version;
