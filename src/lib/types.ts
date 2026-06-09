export type ParsedCardInfo = {
  cardName: string;
  cardNumber?: string;
  rarity?: string;
  rawText: string;
  language: "ko" | "unknown";
};

export type KreamListing = {
  title: string;
  price: number | null;
  imageUrl?: string;
  url?: string;
  keyword: string;
  collectedAt: string;
};

export type PriceStats = {
  lowest: number;
  median: number;
  average: number;
  highest: number;
  count: number;
};

export type PriceResult = {
  query: string;
  source: "KREAM" | "Collectory";
  stats: PriceStats | null;
  listings: KreamListing[];
  collectedAt: string;
  cached: boolean;
  searchUrl: string;
  warnings: string[];
};
