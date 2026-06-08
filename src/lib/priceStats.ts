import type { KreamListing, PriceStats } from "@/lib/types";

export function calculateStats(listings: KreamListing[]): PriceStats | null {
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

export function formatWon(value?: number | null) {
  if (!value) return "-";
  return `${value.toLocaleString("ko-KR")}원`;
}
