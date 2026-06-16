/**
 * offlineCommands.js — #159
 * Static cacheable offline command catalog for Sylex car mode.
 *
 * The client fetches this once via GET /v1/voice/offline-commands
 * (Cache-Control: public, max-age=86400) and stores it locally.
 * When the device has no network, the client matches voice input
 * against these trigger phrases and returns the pre-baked response
 * without a server call.
 *
 * Matching: case-insensitive, trimmed, any trigger phrase matches.
 * action: optional — hints to the client which native action to invoke.
 */

export const OFFLINE_COMMANDS = [
  {
    id: 'call_home',
    triggers: ['call home', 'ruf zuhause an', 'nach hause anrufen', 'call mom', 'mama anrufen'],
    response: {
      de: 'Ich rufe jetzt zuhause an.',
      en: 'Calling home now.',
    },
    action: 'CALL_CONTACT',
    actionParam: 'home',
  },
  {
    id: 'navigate_home',
    triggers: ['navigate home', 'navigate to home', 'nach hause', 'nach hause navigieren', 'drive home', 'heimfahren'],
    response: {
      de: 'Navigation nach Hause wird gestartet.',
      en: 'Starting navigation to home.',
    },
    action: 'NAVIGATE_HOME',
    actionParam: null,
  },
  {
    id: 'stop',
    triggers: ['stop', 'stopp', 'cancel', 'abbrechen', 'halt', 'beenden'],
    response: {
      de: 'Okay, ich höre auf.',
      en: 'Okay, stopping.',
    },
    action: 'STOP',
    actionParam: null,
  },
  {
    id: 'repeat',
    triggers: ['repeat', 'wiederholen', 'nochmal', 'say that again', 'was hast du gesagt'],
    response: {
      de: 'Entschuldigung, ich konnte das nicht hören. Bitte versuch es nochmal.',
      en: 'Sorry, I didn\'t catch that. Please try again.',
    },
    action: null,
    actionParam: null,
  },
  {
    id: 'play_music',
    triggers: ['play music', 'musik abspielen', 'musik', 'music', 'play', 'abspielen'],
    response: {
      de: 'Musik-App wird geöffnet.',
      en: 'Opening your music app.',
    },
    action: 'OPEN_MUSIC',
    actionParam: null,
  },
  {
    id: 'volume_up',
    triggers: ['volume up', 'lauter', 'louder', 'turn it up', 'lautstärke erhöhen'],
    response: {
      de: 'Lautstärke wird erhöht.',
      en: 'Turning volume up.',
    },
    action: 'VOLUME_UP',
    actionParam: null,
  },
  {
    id: 'volume_down',
    triggers: ['volume down', 'leiser', 'quieter', 'turn it down', 'lautstärke verringern'],
    response: {
      de: 'Lautstärke wird verringert.',
      en: 'Turning volume down.',
    },
    action: 'VOLUME_DOWN',
    actionParam: null,
  },
  {
    id: 'help',
    triggers: ['hey sylex help', 'hilfe', 'help', 'was kannst du', 'what can you do', 'sylex help'],
    response: {
      de: 'Ich bin Sylex. Ich kann navigieren, Kontakte anrufen und Fragen beantworten. Sag einfach einen Befehl.',
      en: 'I\'m Sylex. I can navigate, call contacts, and answer questions. Say a command.',
    },
    action: null,
    actionParam: null,
  },
  {
    id: 'no_network',
    triggers: ['__fallback__'],
    response: {
      de: 'Ich bin gerade offline und kann das nicht beantworten. Ich erinnere dich daran, wenn du wieder verbunden bist.',
      en: 'I\'m currently offline and can\'t answer that. I\'ll remind you when you\'re connected again.',
    },
    action: null,
    actionParam: null,
  },
];

export default OFFLINE_COMMANDS;
