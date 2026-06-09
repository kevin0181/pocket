import { calculateStats } from "@/lib/priceStats";
import type { KreamListing, PriceResult } from "@/lib/types";

const COLLECTORY_BASE_URL = "https://collectory.cc";

export function makeCollectorySearchUrl(keyword: string) {
  const params = new URLSearchParams({ q: keyword });
  return `${COLLECTORY_BASE_URL}/cards?${params.toString()}`;
}

export async function searchCollectory(keyword: string, target?: { cardName?: string; cardNumber?: string; rarity?: string }): Promise<PriceResult> {
  const collectedAt = new Date().toISOString();
  const searchUrl = makeCollectorySearchUrl(keyword);
  const warnings: string[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
      next: { revalidate: 0 },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return emptyResult(keyword, collectedAt, searchUrl, [`Collectory가 ${response.status}로 응답했습니다.`]);
    }

    const html = await response.text();
    const parsed = extractCardsFromSearchHtml(html, keyword, collectedAt);
    const listings = filterCollectoryListings(parsed, target).slice(0, 8);

    if (parsed.length === 0) warnings.push("Collectory 검색 결과에서 카드 데이터를 파싱하지 못했습니다.");
    if (parsed.length > 0 && listings.length === 0) warnings.push("Collectory 후보는 찾았지만 카드명/번호/레어도 기준을 통과하지 못했습니다.");

    return {
      query: keyword,
      source: "Collectory",
      stats: calculateStats(listings),
      listings,
      collectedAt,
      cached: false,
      searchUrl,
      warnings,
    };
  } catch (error) {
    clearTimeout(timeout);
    return emptyResult(keyword, collectedAt, searchUrl, [`Collectory 요청 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`]);
  }
}

function extractCardsFromSearchHtml(html: string, keyword: string, collectedAt: string) {
  const listings: KreamListing[] = [];
  const decoded = decodeHtml(html);
  const cardRegex = /<a class="group[\s\S]*?href="\/cards\/([^"]+)"[\s\S]*?<\/a>/g;

  for (const match of decoded.matchAll(cardRegex)) {
    const block = match[0];
    const id = match[1];
    const name = cleanupText(block.match(/<p class="text-sm font-medium truncate flex-1 min-w-0" title="([^"]+)"/)?.[1] || "");
    const imageAlt = cleanupText(block.match(/<img\b[^>]*\balt="([^"]+)"/)?.[1] || "");
    const imageUrl = cleanupText(block.match(/<img\b[^>]*\bsrc="([^"]+)"/)?.[1] || "");
    const cardNumber = cleanupText(block.match(/<span class="block text-xs text-muted-foreground truncate">([^<]+)<\/span>/)?.[1] || "");
    const priceText =
      cleanupText(block.match(/<span class="font-semibold text-primary">([^<]+)<\/span>/)?.[1] || "") ||
      cleanupText(block.match(/<span class="text-muted-foreground">([^<]+)<\/span>/)?.[1] || "");
    const rarity = inferRarity(block, imageUrl);
    const price = parsePrice(priceText);
    const title = [name || imageAlt, cardNumber, rarity].filter(Boolean).join(" ");

    if (!title) continue;

    listings.push({
      title,
      price,
      imageUrl: imageUrl || undefined,
      url: `${COLLECTORY_BASE_URL}/cards/${id}`,
      keyword,
      collectedAt,
    });
  }

  return dedupeListings(listings);
}

function inferRarity(block: string, imageUrl: string) {
  const fromImage = imageUrl.match(/\d+_\d+([A-Z]+)\.webp/i)?.[1]?.toUpperCase();
  if (fromImage) return fromImage;

  const badgeMatches = Array.from(block.matchAll(/<span data-slot="badge"[\s\S]*?>([^<]+)<\/span>/g));
  return cleanupText(badgeMatches.find((match) => /^[A-Z]{1,4}$/i.test(cleanupText(match[1])))?.[1] || "");
}

function filterCollectoryListings(listings: KreamListing[], target?: { cardName?: string; cardNumber?: string; rarity?: string }) {
  const nameToken = target?.cardName?.replace(/\s+/g, "").slice(0, 3);
  const cardNumber = target?.cardNumber?.replace(/\s/g, "");
  const rarity = target?.rarity?.toUpperCase();

  return listings
    .filter((listing) => {
      const compact = listing.title.replace(/\s+/g, "").toUpperCase();
      if (nameToken && !compact.includes(nameToken.toUpperCase())) return false;
      return true;
    })
    .sort((a, b) => scoreCollectoryListing(b, cardNumber, rarity) - scoreCollectoryListing(a, cardNumber, rarity));
}

function scoreCollectoryListing(listing: KreamListing, cardNumber?: string, rarity?: string) {
  const compact = listing.title.replace(/\s+/g, "").toUpperCase();
  let score = 0;
  if (listing.price) score += 3;
  if (cardNumber && compact.includes(cardNumber.toUpperCase())) score += 8;
  if (rarity && compact.includes(rarity)) score += 5;
  return score;
}

function emptyResult(query: string, collectedAt: string, searchUrl: string, warnings: string[]): PriceResult {
  return {
    query,
    source: "Collectory",
    stats: null,
    listings: [],
    collectedAt,
    cached: false,
    searchUrl,
    warnings,
  };
}

function parsePrice(value: string) {
  const parsed = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanupText(value: string) {
  return decodeHtml(value)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
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
    const key = `${listing.title}:${listing.price}:${listing.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
