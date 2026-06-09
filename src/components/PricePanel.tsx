"use client";

import { useMemo } from "react";
import { formatWon } from "@/lib/priceStats";
import type { KreamListing, ParsedCardInfo, PriceResult } from "@/lib/types";

type SearchResponse = {
  cardInfo: ParsedCardInfo;
  queries: string[];
  result: PriceResult;
};

export function PricePanel({ data, loading }: { data?: SearchResponse | null; loading?: boolean }) {
  const cardInfo = data?.cardInfo;
  const result = data?.result;
  const variantGroups = useMemo(() => groupListingsByVariant(result?.listings || []), [result?.listings]);
  const sourceLabel =
    result?.source === "CollectoryDB" ? "DB 저장 시세" : result?.source === "Collectory" ? "Collectory 참고 시세" : "KREAM 참고 시세";
  const sourceActionLabel = result?.source === "KREAM" ? "KREAM 검색 열기" : "Collectory 검색 열기";

  return (
    <div className="stack">
      <section className="panel stack info-panel">
        <h2>인식된 카드 정보</h2>
        {cardInfo ? (
          <>
            <InfoRow label="카드명" value={cardInfo.cardName || "-"} />
            <InfoRow label="카드번호" value={cardInfo.cardNumber || "-"} />
            <InfoRow label="레어도" value={cardInfo.rarity || "-"} />
            <InfoRow label="언어" value={cardInfo.language === "ko" ? "한글판 추정" : "확인 필요"} />
            <div className="ocr-box">{cardInfo.rawText || "OCR 원문 없음"}</div>
          </>
        ) : (
          <p className="subtle">카드를 비추거나 직접 검색하면 여기에 결과가 표시됩니다.</p>
        )}
      </section>

      <section className="panel stack">
        <h2>{sourceLabel}</h2>
        {loading ? <p className="subtle">DB 저장 시세를 먼저 확인하는 중...</p> : null}
        {result?.stats ? (
          <div className="metric-grid">
            <Metric label="중앙값" value={formatWon(result.stats.median)} />
            <Metric label="최저가" value={formatWon(result.stats.lowest)} />
            <Metric label="평균가" value={formatWon(result.stats.average)} />
            <Metric label="최고가" value={formatWon(result.stats.highest)} />
            <Metric label="매물 수" value={`${result.stats.count}개`} />
            <Metric label="캐시" value={result.cached ? "사용함" : "새로 수집"} />
          </div>
        ) : (
          <p className="subtle">아직 표시할 가격 데이터가 없습니다.</p>
        )}
        {result ? (
          <a className="button" href={result.searchUrl} target="_blank" rel="noreferrer">
            {sourceActionLabel}
          </a>
        ) : null}
        {result?.warnings.length ? (
          <p className="subtle">{result.warnings.join(" ")}</p>
        ) : null}
      </section>

      {data?.queries?.length ? (
        <section className="panel stack">
          <h3>검색어 후보</h3>
          {data.queries.map((query) => (
            <div className="row" key={query}>
              <span>{query}</span>
            </div>
          ))}
        </section>
      ) : null}

      {result?.listings.length ? (
        <section className="panel stack results-panel">
          <div className="section-heading">
            <h3>카드 종류 후보</h3>
            <span className="subtle">{variantGroups.length}종 / {result.listings.length}개 데이터</span>
          </div>
          <div className="variant-grid">
            {variantGroups.map((group) => (
              <a className="variant-card" href={group.url || result.searchUrl} target="_blank" rel="noreferrer" key={group.key}>
                {group.imageUrl ? <img className="variant-image" src={group.imageUrl} alt="" /> : <span className="variant-image image-fallback" />}
                <span className="variant-body">
                  <span className="variant-title">{group.name}</span>
                  <span className="variant-meta">
                    {group.number ? <Badge>{group.number}</Badge> : null}
                    {group.rarity ? <Badge>{group.rarity}</Badge> : null}
                    {group.setName ? <Badge>{group.setName}</Badge> : null}
                  </span>
                  <span className="variant-price-row">
                    <strong>{formatWon(group.medianPrice || group.lowestPrice || group.highestPrice)}</strong>
                    {group.count > 1 ? <small>{group.count}개 가격</small> : null}
                  </span>
                  <span className="price-range">
                    <span>최저 {formatWon(group.lowestPrice)}</span>
                    <span>최고 {formatWon(group.highestPrice)}</span>
                  </span>
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span className="subtle">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return <span className="badge">{children}</span>;
}

type VariantGroup = {
  key: string;
  name: string;
  number?: string;
  rarity?: string;
  setName?: string;
  imageUrl?: string;
  url?: string;
  count: number;
  lowestPrice: number | null;
  medianPrice: number | null;
  highestPrice: number | null;
};

function groupListingsByVariant(listings: KreamListing[]): VariantGroup[] {
  const groups = new Map<string, KreamListing[]>();

  for (const listing of listings) {
    const parsed = parseListingTitle(listing.title);
    const key = [parsed.name, parsed.number, parsed.rarity, parsed.setName].filter(Boolean).join("|") || listing.title;
    groups.set(key, [...(groups.get(key) || []), listing]);
  }

  return Array.from(groups.entries())
    .map(([key, groupListings]) => {
      const parsed = parseListingTitle(groupListings[0].title);
      const prices = groupListings
        .map((listing) => listing.price)
        .filter((price): price is number => typeof price === "number" && Number.isFinite(price) && price > 0)
        .sort((a, b) => a - b);
      const middle = Math.floor(prices.length / 2);
      const medianPrice = prices.length ? (prices.length % 2 === 0 ? Math.round((prices[middle - 1] + prices[middle]) / 2) : prices[middle]) : null;

      return {
        key,
        ...parsed,
        imageUrl: groupListings.find((listing) => listing.imageUrl)?.imageUrl,
        url: groupListings.find((listing) => listing.url)?.url,
        count: prices.length || groupListings.length,
        lowestPrice: prices[0] || null,
        medianPrice,
        highestPrice: prices[prices.length - 1] || null,
      };
    })
    .sort((a, b) => {
      const priceA = a.medianPrice || a.lowestPrice || 0;
      const priceB = b.medianPrice || b.lowestPrice || 0;
      return priceB - priceA;
    });
}

function parseListingTitle(title: string) {
  const setMatch = title.match(/\(([^)]+)\)\s*$/);
  const withoutSet = title.replace(/\s*\([^)]+\)\s*$/, "").trim();
  const number = withoutSet.match(/\b\d{1,3}\s*\/\s*\d{1,3}(?:[-A-Z]*)?\b/i)?.[0]?.replace(/\s/g, "");
  const rarity = withoutSet.match(/\b(SAR|RRR|SR|AR|UR|RR|CHR|CSR|HR|SSR|S|R|U|C|N)\b/i)?.[1]?.toUpperCase();
  const name = withoutSet
    .replace(/\b\d{1,3}\s*\/\s*\d{1,3}(?:[-A-Z]*)?\b/gi, "")
    .replace(/\b(SAR|RRR|SR|AR|UR|RR|CHR|CSR|HR|SSR|S|R|U|C|N)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    name: name || title,
    number,
    rarity,
    setName: setMatch?.[1],
  };
}
