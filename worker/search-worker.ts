type ParsedCardInfo = {
  cardName: string;
  cardNumber?: string;
  rarity?: string;
  rawText: string;
  language: "ko" | "unknown";
};

type KreamListing = {
  title: string;
  price: number | null;
  imageUrl?: string;
  url?: string;
  keyword: string;
  collectedAt: string;
};

const RARITIES = ["SAR", "RRR", "SR", "AR", "UR", "RR", "R", "U", "C"];
const CARD_NUMBER_PATTERN = /\b\d{1,3}\s*\/\s*\d{1,3}\b/;
const EXCLUDE_KEYWORDS = ["슬리브", "케이스", "탑로더", "박스", "팩", "스티커", "인형", "오리카", "프록시", "가품"];
const NON_SINGLE_CARD_KEYWORDS = ["스타터", "스타트", "세트", "덱", "배틀컬렉션", "부스터", "박스"];
const FOREIGN_LANGUAGE_KEYWORDS = ["일본판", "일어판", "영문판", "영어판", "Japanese Ver", "English Ver"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return json({ error: "POST만 지원합니다." }, 405);
    }

    const body = (await request.json().catch(() => null)) as { query?: string; rawText?: string } | null;
    if (!body?.query && !body?.rawText) {
      return json({ error: "query 또는 rawText가 필요합니다." }, 400);
    }

    const cardInfo = body.rawText ? parseOcrText(body.rawText) : parseManualQuery(body.query || "");
    if (body.rawText && !hasSearchableCardSignal(cardInfo)) {
      return json(
        {
          cardInfo,
          queries: [],
          error: "카드명과 카드번호 또는 레어도가 충분히 읽히지 않았습니다.",
        },
        422,
      );
    }

    const queries = body.query ? [body.query.trim(), ...buildKreamQueries(cardInfo)] : buildKreamQueries(cardInfo);
    const uniqueQueries = Array.from(new Set(queries.filter(Boolean)));
    const tried = [];

    for (const query of uniqueQueries) {
      const result = await searchKream(query, cardInfo);
      tried.push(result);
      if (result.listings.length > 0) {
        return json({ cardInfo, queries: uniqueQueries, worker: workerInfo(request), result });
      }
    }

    return json({ cardInfo, queries: uniqueQueries, worker: workerInfo(request), tried, result: tried[0] });
  },
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function workerInfo(request: Request) {
  const cf = (request as Request & { cf?: { colo?: string; country?: string } }).cf;
  return {
    colo: cf?.colo || "unknown",
    country: cf?.country || "unknown",
  };
}

function parseOcrText(rawText: string): ParsedCardInfo {
  const normalized = rawText.replace(/\r/g, "\n").replace(/[|｜]/g, "/").replace(/\s+\/\s+/g, "/").trim();
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const cardNumber = normalizeCardNumber(normalized.match(CARD_NUMBER_PATTERN)?.[0]);
  const rarity = findRarity(normalized);
  const cardName = findCardName(lines, cardNumber, rarity);

  return {
    cardName,
    cardNumber,
    rarity,
    rawText: normalized,
    language: /[가-힣]/.test(normalized) ? "ko" : "unknown",
  };
}

function parseManualQuery(query: string) {
  const rawText = query.trim();
  const cardNumber = normalizeCardNumber(rawText.match(CARD_NUMBER_PATTERN)?.[0]);
  const rarity = findRarity(rawText);
  const cardName = rawText
    .replace(CARD_NUMBER_PATTERN, "")
    .replace(/\b(SAR|RRR|SR|AR|UR|RR|R|U|C)\b/gi, "")
    .replace(/한글판|포켓몬카드/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return parseOcrText([cardName || rawText, cardNumber, rarity].filter(Boolean).join("\n"));
}

function hasSearchableCardSignal(info: ParsedCardInfo) {
  const name = info.cardName.replace(/\s+/g, "");
  return /[가-힣]{2,}/.test(name) && Boolean(info.cardNumber || info.rarity);
}

function buildKreamQueries(info: ParsedCardInfo | { cardName: string; cardNumber?: string; rarity?: string }) {
  const name = info.cardName.trim();
  const queries = [
    [name, info.cardNumber, info.rarity, "한글판"].filter(Boolean).join(" "),
    [name, info.rarity, "한글판"].filter(Boolean).join(" "),
    ["포켓몬카드", name, info.cardNumber].filter(Boolean).join(" "),
    ["포켓몬카드", name, "한글판"].filter(Boolean).join(" "),
  ];

  return Array.from(new Set(queries.filter((query) => query.trim().length >= 2)));
}

function findRarity(text: string) {
  const upper = text.toUpperCase();
  return RARITIES.find((rarity) => new RegExp(`\\b${rarity}\\b`).test(upper));
}

function findCardName(lines: string[], cardNumber?: string, rarity?: string) {
  const candidates = lines.map(cleanCardNameCandidate).filter((line) => {
    if (cardNumber && line.includes(cardNumber)) return false;
    if (rarity && line.toUpperCase() === rarity) return false;
    return /[가-힣]{2,}/.test(line) || /\b(ex|gx|vmax|vstar|v)\b/i.test(line);
  });

  return candidates[0]?.replace(/\s+/g, " ").trim() || lines[0]?.replace(/\s+/g, " ").trim() || "";
}

function cleanCardNameCandidate(line: string) {
  const beforeNoise = line
    .replace(CARD_NUMBER_PATTERN, " ")
    .split(/\/\/|[\\/]{2,}|BD|HP\s*\d+|TR\s*:|We\s|Coad|Shot|사용할 수 있다|[=<>"]/i)[0]
    .replace(/[^\p{Script=Hangul}\p{Script=Latin}\d\s-]/gu, " ")
    .replace(/\b[A-Z]{2,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const koreanMatch = beforeNoise.match(/[가-힣][가-힣\s]{1,18}(?:\s(?:ex|EX|V|GX|VMAX|VSTAR))?/);
  return (koreanMatch?.[0] || beforeNoise).trim();
}

function normalizeCardNumber(value?: string) {
  if (!value) return undefined;
  const [rawLeft, rawRight] = value.replace(/\s/g, "").split("/");
  if (!rawLeft || !rawRight) return undefined;

  let left = rawLeft;
  let right = rawRight;
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (left.length === 3 && right.length <= 2 && leftNumber > rightNumber && left.endsWith("0")) {
    left = `0${left.slice(0, 2)}`;
  }
  if (right.length === 2 && left.length === 3) {
    right = `0${right}`;
  }

  return `${left}/${right}`;
}

function makeKreamSearchUrl(keyword: string) {
  const params = new URLSearchParams({ keyword, tab: "products" });
  return `https://www.kream.co.kr/search?${params.toString()}`;
}

async function searchKream(keyword: string, target?: { cardName?: string; cardNumber?: string; rarity?: string }) {
  const collectedAt = new Date().toISOString();
  const searchUrl = makeKreamSearchUrl(keyword);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(makeKreamApiSearchUrl(keyword), {
      signal: controller.signal,
      headers: makeKreamApiHeaders(searchUrl),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return priceResult(keyword, searchUrl, collectedAt, [], [`KREAM API가 ${response.status}로 응답했습니다.`]);
    }

    const data = await response.json();
    const parsed = extractProductsFromApi(data, keyword, collectedAt);
    const filtered = filterListings(parsed, target).slice(0, 8);
    const listings = await enrichListingsWithProductDetails(filtered, searchUrl);
    const warnings: string[] = [];

    if (parsed.length === 0) warnings.push("KREAM API에서 상품 데이터를 파싱하지 못했습니다.");
    if (parsed.length > 0 && listings.length === 0) warnings.push("파싱된 결과가 필터링 기준을 통과하지 못했습니다.");
    if (listings.length > 0 && !listings.some((listing) => listing.price)) {
      warnings.push("KREAM 상품은 찾았지만 가격 정보가 없어 통계는 계산하지 못했습니다.");
    }

    return priceResult(keyword, searchUrl, collectedAt, listings, warnings);
  } catch (error) {
    clearTimeout(timeout);
    return priceResult(keyword, searchUrl, collectedAt, [], [
      `KREAM 요청 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
    ]);
  }
}

function makeKreamApiSearchUrl(keyword: string) {
  const params = new URLSearchParams({
    keyword,
    request_key: crypto.randomUUID().replace(/-/g, ""),
  });
  return `https://api.kream.co.kr/api/screens/search/products?${params.toString()}`;
}

function makeKreamProductApiUrl(productId: string | number) {
  const params = new URLSearchParams({
    request_key: crypto.randomUUID().replace(/-/g, ""),
  });
  return `https://api.kream.co.kr/api/p/products/${productId}?${params.toString()}`;
}

function makeKreamApiHeaders(referer: string) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);

  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
    origin: "https://kream.co.kr",
    referer,
    "user-agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "x-kream-api-version": "59",
    "x-kream-client-datetime": `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}+0900`,
    "x-kream-device-id": `web;${crypto.randomUUID()}`,
    "x-kream-web-build-version": "26.7.1",
    "x-kream-web-request-secret": "kream-djscjsghdkd",
  };
}

function extractProductsFromApi(data: unknown, keyword: string, collectedAt: string) {
  const listings: KreamListing[] = [];
  collectApiProducts(data, listings, keyword, collectedAt);
  return dedupeListings(listings);
}

function collectApiProducts(value: unknown, listings: KreamListing[], keyword: string, collectedAt: string) {
  if (!value || listings.length > 80) return;
  if (typeof value === "string") {
    collectProductJsonString(value, listings, keyword, collectedAt);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectApiProducts(item, listings, keyword, collectedAt));
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const productId = normalizeProductId(firstString(record, ["product_id", "productId", "id"]));
  const title = firstString(record, ["product_name_ko", "translated_name", "translatedName", "productName", "name", "title"]);
  const imageUrl = firstString(record, ["image_url", "imageUrl", "thumbnail_url", "thumbnailUrl"]);
  const price = firstPrice(record, ["last_sale_price", "lastSalePrice", "last_price_normal", "lowest_ask", "price", "amount"]);

  if (productId && title && /포켓몬|Pokemon|TCG/i.test(title)) {
    listings.push({
      title,
      price: price || null,
      imageUrl,
      url: `https://www.kream.co.kr/products/${productId}`,
      keyword,
      collectedAt,
    });
  }

  Object.values(record).forEach((child) => collectApiProducts(child, listings, keyword, collectedAt));
}

function collectProductJsonString(value: string, listings: KreamListing[], keyword: string, collectedAt: string) {
  const trimmed = value.trim();
  if (!trimmed.includes("product_id") && !trimmed.includes("product_name_ko")) return;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;

  try {
    collectApiProducts(JSON.parse(trimmed), listings, keyword, collectedAt);
  } catch {
    // KREAM mixes structured event payloads with regular strings.
  }
}

async function enrichListingsWithProductDetails(listings: KreamListing[], referer: string) {
  const enriched: KreamListing[] = [];

  for (const listing of listings) {
    const productId = listing.url?.match(/\/products\/(\d+)/)?.[1];
    if (!productId || listing.price) {
      enriched.push(listing);
      continue;
    }

    try {
      const response = await fetch(makeKreamProductApiUrl(productId), {
        headers: makeKreamApiHeaders(referer),
      });
      if (!response.ok) {
        enriched.push(listing);
        continue;
      }

      const detail = (await response.json()) as Record<string, unknown>;
      const release = typeof detail.release === "object" && detail.release ? (detail.release as Record<string, unknown>) : {};
      const market = typeof detail.market === "object" && detail.market ? (detail.market as Record<string, unknown>) : {};
      const price = firstPrice(market, ["last_sale_price", "last_price_normal", "lowest_ask"]);
      const imageUrl = firstString(release, ["image_url", "imageUrl"]) || firstImageUrl(release["image_urls"]);

      enriched.push({
        ...listing,
        price: price || listing.price,
        imageUrl: imageUrl || listing.imageUrl,
      });
    } catch {
      enriched.push(listing);
    }
  }

  return enriched;
}

function priceResult(query: string, searchUrl: string, collectedAt: string, listings: KreamListing[], warnings: string[]) {
  return {
    query,
    source: "KREAM",
    stats: calculateStats(listings),
    listings,
    collectedAt,
    cached: false,
    searchUrl,
    warnings,
  };
}

function extractProductCardsFromHtml(html: string, keyword: string, collectedAt: string) {
  const listings: KreamListing[] = [];
  const decoded = decodeHtml(html);
  const cardRegex = /<a\b[^>]*class="[^"]*product_card[^"]*"[^>]*href="\/products\/(\d+)"[\s\S]*?<\/a>/gi;

  for (const match of decoded.matchAll(cardRegex)) {
    const block = match[0];
    const productId = match[1];
    const title = cleanupText(block.match(/<img\b[^>]*\balt="([^"]+)"/i)?.[1] || "");
    const imageUrl = cleanupText(block.match(/<img\b[^>]*\bsrc="([^"]+)"/i)?.[1] || "");
    const priceText =
      cleanupText(block.match(/product_price\/\d+[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "") ||
      cleanupText(block.match(/([\d,]+원)/)?.[1] || "");
    const price = parsePrice(priceText);

    if (title) {
      listings.push({
        title,
        price,
        imageUrl: imageUrl || undefined,
        url: `https://www.kream.co.kr/products/${productId}`,
        keyword,
        collectedAt,
      });
    }
  }

  return dedupeListings(listings);
}

function filterListings(listings: KreamListing[], target?: { cardName?: string; cardNumber?: string; rarity?: string }) {
  const nameToken = target?.cardName?.replace(/\s+/g, "").slice(0, 3);
  const cardNumber = target?.cardNumber?.replace(/\s/g, "");
  const rarity = target?.rarity?.toUpperCase();

  return listings
    .filter((listing) => {
      const compact = listing.title.replace(/\s+/g, "");
      if (listing.price !== null && listing.price < 1000) return false;
      if (EXCLUDE_KEYWORDS.some((word) => listing.title.includes(word))) return false;
      if (NON_SINGLE_CARD_KEYWORDS.some((word) => listing.title.includes(word))) return false;
      if (FOREIGN_LANGUAGE_KEYWORDS.some((word) => listing.title.includes(word))) return false;
      if (nameToken && !compact.includes(nameToken)) return false;
      return true;
    })
    .sort((a, b) => scoreListing(b, cardNumber, rarity) - scoreListing(a, cardNumber, rarity));
}

function scoreListing(listing: KreamListing, cardNumber?: string, rarity?: string) {
  const compact = listing.title.replace(/\s+/g, "").toUpperCase();
  let score = 0;
  if (cardNumber && compact.includes(cardNumber.toUpperCase())) score += 8;
  if (rarity && compact.includes(rarity)) score += 5;
  if (listing.title.includes("한글판") || listing.title.includes("한국어")) score += 4;
  if (listing.title.includes("포켓몬") || listing.title.toUpperCase().includes("POKEMON")) score += 2;
  return score;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return cleanupText(value);
    if (typeof value === "number") return String(value);
  }
}

function firstPrice(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const price = parsePrice(record[key]);
    if (price) return price;
  }
}

function firstImageUrl(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === "string" && item.startsWith("http"));
  }
  if (typeof value === "string" && value.startsWith("http")) return value;
}

function normalizeProductId(value?: string) {
  if (!value) return undefined;
  return value.match(/\d+/)?.[0];
}

function calculateStats(listings: KreamListing[]) {
  const prices = listings
    .map((listing) => listing.price)
    .filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);

  if (prices.length === 0) return null;

  const middle = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0 ? Math.round((prices[middle - 1] + prices[middle]) / 2) : prices[middle];
  const average = Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length);

  return {
    lowest: prices[0],
    median,
    average,
    highest: prices[prices.length - 1],
    count: prices.length,
  };
}

function parsePrice(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanupText(value: string) {
  return decodeHtml(value)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\u([\dA-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function dedupeListings(listings: KreamListing[]) {
  const seen = new Set<string>();
  return listings.filter((listing) => {
    const key = `${listing.title}:${listing.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
