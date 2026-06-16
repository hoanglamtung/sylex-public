// Client-side grounding classifier.
// Server trusts this flag and does not perform keyword-based grounding checks.

// ASCII keywords — word-boundary safe (en, fr, de, es, it, tr, pl, ru with Latin chars)
const REALTIME_ASCII = /\b(weather|forecast|news|today|tonight|tomorrow|current|right now|price|score|traffic jam|accident|breaking|traffic|fuel|stock|exchange rate|m[eé]t[eé]o|pr[eé]visions|aujourd'?hui|demain|maintenant|actuel|trafic|bourse|carburant|wetter|vorhersage|heute|morgen|jetzt|aktuell|verkehr|unfall|nachrichten|kurs|benzin|clima|pron[oó]stico|hoy|ma[nñ]ana|ahora|actual|tr[aá]fico|accidente|noticias|combustible|meteo|previsioni|oggi|stasera|domani|adesso|traffico|incidente|prezzo|hava|trafik|tahmin|bug[üu]n|yar[ıi]n|[şs]imdi|g[üu]ncel|kaza|haberler|yak[ıi]t|pogoda|prognoza|dzisiaj|jutro|teraz|aktualny|wypadek|wiadomo[śs]ci|paliwo)\b/i;

// Unicode keywords — no word boundaries needed (zh, jp, ko, vi, ru Cyrillic)
const REALTIME_UNICODE = /天气|天候|予報|预报|今天|今日|今夜|今晚|明天|明日|现在|今|交通|事故|新闻|ニュース|뉴스|股票|株価|주가|汇率|為替|환율|油价|燃料|날씨|오늘|오늘밤|내일|지금|현재|교통|사고|가격|погода|прогноз|сегодня|завтра|сейчас|пробки|авария|новости|курс|thời tiết|dự báo|hôm nay|tối nay|ngày mai|bây giờ|hiện tại|giao thông|tai nạn|giá cả|tin tức/;

export function shouldUseGrounding(text: string): boolean {
  if (!text) return false;
  return REALTIME_ASCII.test(text) || REALTIME_UNICODE.test(text);
}
