import { calculateStats } from "@/lib/priceStats";
import type { KreamListing, PriceResult } from "@/lib/types";

const EXCLUDE_KEYWORDS = ["슬리브", "케이스", "탑로더", "박스", "팩", "스티커", "인형", "오리카", "프록시", "가품"];
const NON_SINGLE_CARD_KEYWORDS = ["스타터", "스타트", "세트", "덱", "배틀컬렉션", "부스터", "박스"];
const FOREIGN_LANGUAGE_KEYWORDS = ["일본판", "일어판", "영문판", "영어판", "Japanese Ver", "English Ver"];

export function makeKreamSearchUrl(keyword: string) {
  const params = new URLSearchParams({ keyword, tab: "products" });
  return `https://www.kream.co.kr/search?${params.toString()}`;
}

export async function searchKream(keyword: string, target?: { cardName?: string; cardNumber?: string; rarity?: string }): Promise<PriceResult> {
  const collectedAt = new Date().toISOString();
  const searchUrl = makeKreamSearchUrl(keyword);
  const warnings: string[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(makeKreamApiSearchUrl(keyword), {
      signal: controller.signal,
      headers: makeKreamApiHeaders(searchUrl),
      next: { revalidate: 0 },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        query: keyword,
        source: "KREAM",
        stats: null,
        listings: [],
        collectedAt,
        cached: false,
        searchUrl,
        warnings: [`KREAM API가 ${response.status}로 응답했습니다. 버튼으로 KREAM 검색 결과를 직접 확인해 주세요.`],
      };
    }

    const data = await response.json();
    const parsed = extractProductsFromApi(data, keyword, collectedAt);
    const filtered = filterListings(parsed, target).slice(0, 8);
    const listings = await enrichListingsWithProductDetails(filtered, searchUrl);

    if (parsed.length === 0) warnings.push("KREAM API에서 상품 데이터를 파싱하지 못했습니다.");
    if (parsed.length > 0 && listings.length === 0) warnings.push("파싱된 결과가 필터링 기준을 통과하지 못했습니다.");
    if (listings.length > 0 && !listings.some((listing) => listing.price)) {
      warnings.push("KREAM 상품은 찾았지만 가격 정보가 없어 통계는 계산하지 못했습니다.");
    }

    return {
      query: keyword,
      source: "KREAM",
      stats: calculateStats(listings),
      listings,
      collectedAt,
      cached: false,
      searchUrl,
      warnings,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      query: keyword,
      source: "KREAM",
      stats: null,
      listings: [],
      collectedAt,
      cached: false,
      searchUrl,
      warnings: [`KREAM 요청 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`],
    };
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
  const now = new Date();
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const timezone = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;

  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
    origin: "https://kream.co.kr",
    referer,
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "x-kream-api-version": "59",
    "x-kream-client-datetime": `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}${timezone}`,
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
    // Some KREAM fields are human-readable text rather than JSON payloads.
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
        next: { revalidate: 0 },
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

function extractListingsFromHtml(html: string, keyword: string, collectedAt: string) {
  const listings: KreamListing[] = [];
  const nextData = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];

  if (nextData) {
    try {
      collectListings(JSON.parse(decodeHtml(nextData)), listings, keyword, collectedAt);
    } catch {
      // KREAM can change its hydration payload. Regex fallback below keeps the provider resilient.
    }
  }

  if (listings.length === 0) {
    listings.push(...extractProductCardsFromHtml(html, keyword, collectedAt));
  }

  if (listings.length === 0) {
    const text = decodeHtml(html);
    const itemRegex = /"((?:[^"\\]|\\.){2,120})"\s*[:,]\s*(?:[^{}]{0,160})?(?:price|amount|salePrice|lastSalePrice)"?\s*[:]\s*"?([\d,]{4,})/gi;
    for (const match of text.matchAll(itemRegex)) {
      const title = cleanupText(match[1]);
      const price = parsePrice(match[2]);
      if (title && price) listings.push({ title, price, keyword, collectedAt });
    }
  }

  return dedupeListings(listings);
}

function collectListings(value: unknown, listings: KreamListing[], keyword: string, collectedAt: string) {
  if (!value || listings.length > 80) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectListings(item, listings, keyword, collectedAt));
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const title = firstString(record, ["name", "title", "translatedName", "displayName", "productName", "brandName"]);
  const price = firstPrice(record, ["price", "amount", "salePrice", "lastSalePrice", "releasePrice", "lowestAsk"]);
  const imageUrl = firstString(record, ["imageUrl", "image_url", "thumbnailUrl", "thumbnail_url", "originalUrl"]);
  const productId = firstString(record, ["id", "productId", "product_id"]);
  const slug = firstString(record, ["slug", "url"]);

  if (title) {
    listings.push({
      title,
      price: price || null,
      imageUrl,
      url: slug?.startsWith("http") ? slug : productId ? `https://kream.co.kr/products/${productId}` : undefined,
      keyword,
      collectedAt,
    });
  }

  Object.values(record).forEach((child) => collectListings(child, listings, keyword, collectedAt));
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

function extractProductCardsFromHtml(html: string, keyword: string, collectedAt: string) {
  const listings: KreamListing[] = [];
  const decoded = decodeHtml(html);
  const cardRegex = /<a\b[^>]*class="[^"]*product_card[^"]*"[^>]*href="\/products\/(\d+)"[\s\S]*?<\/a>/gi;

  for (const match of decoded.matchAll(cardRegex)) {
    const block = match[0];
    const productId = match[1];
    const title =
      cleanupText(block.match(/<img\b[^>]*\balt="([^"]+)"/i)?.[1] || "") ||
      cleanupText(block.match(/productName&quot;:&quot;([^"]+)/i)?.[1] || "");
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

  return listings;
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
