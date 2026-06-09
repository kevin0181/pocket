import { calculateStats } from "@/lib/priceStats";
import type { KreamListing, PriceResult } from "@/lib/types";

type DbCardRow = {
  collectory_id: string;
  name: string;
  number: string | null;
  rarity: string | null;
  region: string | null;
  set_name: string | null;
  set_code: string | null;
  image_url: string | null;
  collectory_url: string | null;
  current_price: number | null;
  last_seen_at: string | null;
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

export async function searchCollectoryDatabase(keyword: string, target?: { cardName?: string; cardNumber?: string; rarity?: string }): Promise<PriceResult | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  const collectedAt = new Date().toISOString();
  const searchTerm = (target?.cardName || keyword).trim();
  if (searchTerm.length < 2) return null;

  try {
    const rows = await fetchCards(searchTerm);
    const listings = filterCards(rows, target, keyword, collectedAt).slice(0, 12);

    return {
      query: searchTerm,
      source: "CollectoryDB",
      stats: calculateStats(listings),
      listings,
      collectedAt,
      cached: true,
      searchUrl: `https://collectory.cc/cards?q=${encodeURIComponent(searchTerm)}`,
      warnings: listings.length ? [] : ["DB에서 일치하는 카드 시세를 찾지 못했습니다."],
    };
  } catch (error) {
    return {
      query: searchTerm,
      source: "CollectoryDB",
      stats: null,
      listings: [],
      collectedAt,
      cached: false,
      searchUrl: `https://collectory.cc/cards?q=${encodeURIComponent(searchTerm)}`,
      warnings: [`DB 조회 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`],
    };
  }
}

async function fetchCards(searchTerm: string) {
  const url = new URL("/rest/v1/cards", SUPABASE_URL);
  url.searchParams.set("select", "collectory_id,name,number,rarity,region,set_name,set_code,image_url,collectory_url,current_price,last_seen_at");
  url.searchParams.set("search_text", `ilike.*${escapeLike(searchTerm)}*`);
  url.searchParams.set("order", "current_price.desc.nullslast");
  url.searchParams.set("limit", "40");

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY || "",
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`Supabase ${response.status}`);
  }

  return (await response.json()) as DbCardRow[];
}

function filterCards(rows: DbCardRow[], target: { cardName?: string; cardNumber?: string; rarity?: string } | undefined, keyword: string, collectedAt: string) {
  const cardNumber = target?.cardNumber?.replace(/\s/g, "");
  const rarity = target?.rarity?.toUpperCase();

  return rows
    .map((row): KreamListing => {
      const title = [row.name, row.number, row.rarity, row.set_name ? `(${row.set_name})` : ""].filter(Boolean).join(" ");
      return {
        title,
        price: row.current_price,
        imageUrl: row.image_url || undefined,
        url: row.collectory_url || `https://collectory.cc/cards/${row.collectory_id}`,
        keyword,
        collectedAt: row.last_seen_at || collectedAt,
      };
    })
    .sort((a, b) => scoreListing(b, cardNumber, rarity) - scoreListing(a, cardNumber, rarity));
}

function scoreListing(listing: KreamListing, cardNumber?: string, rarity?: string) {
  const compact = listing.title.replace(/\s+/g, "").toUpperCase();
  let score = 0;
  if (listing.price) score += 3;
  if (cardNumber && compact.includes(cardNumber.toUpperCase())) score += 8;
  if (rarity && compact.includes(rarity)) score += 5;
  return score;
}

function escapeLike(value: string) {
  return value.replace(/[%*_]/g, "");
}
