import { shouldUseGrounding } from '../../src/utils/grounding';

describe('shouldUseGrounding', () => {
  it('returns false for empty string', () => {
    expect(shouldUseGrounding('')).toBe(false);
  });

  it('returns false for generic queries', () => {
    expect(shouldUseGrounding('tell me a joke')).toBe(false);
    expect(shouldUseGrounding('set a timer for 5 minutes')).toBe(false);
    expect(shouldUseGrounding('translate hello to Spanish')).toBe(false);
  });

  // ── English ──────────────────────────────────────────────────────────────
  it('detects English weather', () => expect(shouldUseGrounding("what's the weather today")).toBe(true));
  it('detects English traffic', () => expect(shouldUseGrounding('any traffic on the highway')).toBe(true));
  it('detects English news', () => expect(shouldUseGrounding('show me the latest news')).toBe(true));
  it('detects English stock price', () => expect(shouldUseGrounding('what is the stock price of Apple')).toBe(true));

  // ── French ───────────────────────────────────────────────────────────────
  it('detects French weather (météo)', () => expect(shouldUseGrounding('quelle est la météo demain')).toBe(true));
  it('detects French traffic', () => expect(shouldUseGrounding('il y a du trafic sur la route')).toBe(true));

  // ── German ───────────────────────────────────────────────────────────────
  it('detects German weather (Wetter)', () => expect(shouldUseGrounding('wie ist das Wetter heute')).toBe(true));
  it('detects German traffic (Verkehr)', () => expect(shouldUseGrounding('gibt es Verkehr auf der Autobahn')).toBe(true));

  // ── Spanish ──────────────────────────────────────────────────────────────
  it('detects Spanish weather (clima)', () => expect(shouldUseGrounding('cómo está el clima hoy')).toBe(true));
  it('detects Spanish traffic (tráfico)', () => expect(shouldUseGrounding('hay tráfico en la carretera')).toBe(true));

  // ── Italian ──────────────────────────────────────────────────────────────
  it('detects Italian weather (meteo)', () => expect(shouldUseGrounding('com è il meteo oggi')).toBe(true));

  // ── Turkish ──────────────────────────────────────────────────────────────
  it('detects Turkish weather (hava)', () => expect(shouldUseGrounding('bugün hava nasıl')).toBe(true));
  it('detects Turkish traffic (trafik)', () => expect(shouldUseGrounding('yolda trafik var mı')).toBe(true));

  // ── Polish ───────────────────────────────────────────────────────────────
  it('detects Polish weather (pogoda)', () => expect(shouldUseGrounding('jaka jest pogoda jutro')).toBe(true));

  // ── Russian ──────────────────────────────────────────────────────────────
  it('detects Russian weather (погода)', () => expect(shouldUseGrounding('какая погода сегодня')).toBe(true));
  it('detects Russian traffic (пробки)', () => expect(shouldUseGrounding('есть ли пробки на дороге')).toBe(true));

  // ── Vietnamese ───────────────────────────────────────────────────────────
  it('detects Vietnamese weather (thời tiết)', () => expect(shouldUseGrounding('thời tiết hôm nay thế nào')).toBe(true));
  it('detects Vietnamese traffic (giao thông)', () => expect(shouldUseGrounding('giao thông có kẹt không')).toBe(true));

  // ── Chinese ──────────────────────────────────────────────────────────────
  it('detects Chinese weather (天气)', () => expect(shouldUseGrounding('今天天气怎么样')).toBe(true));
  it('detects Chinese news (新闻)', () => expect(shouldUseGrounding('给我看最新新闻')).toBe(true));

  // ── Japanese ─────────────────────────────────────────────────────────────
  it('detects Japanese weather (天気)', () => expect(shouldUseGrounding('今日の天気は')).toBe(true));
  it('detects Japanese news (ニュース)', () => expect(shouldUseGrounding('最新のニュースを教えて')).toBe(true));

  // ── Korean ───────────────────────────────────────────────────────────────
  it('detects Korean weather (날씨)', () => expect(shouldUseGrounding('오늘 날씨 어때')).toBe(true));
  it('detects Korean traffic (교통)', () => expect(shouldUseGrounding('교통 상황 알려줘')).toBe(true));
});
