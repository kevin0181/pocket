"use client";

import { formatWon } from "@/lib/priceStats";
import type { ParsedCardInfo, PriceResult } from "@/lib/types";

type SearchResponse = {
  cardInfo: ParsedCardInfo;
  queries: string[];
  result: PriceResult;
};

export function PricePanel({ data, loading }: { data?: SearchResponse | null; loading?: boolean }) {
  const cardInfo = data?.cardInfo;
  const result = data?.result;
  const sourceLabel =
    result?.source === "CollectoryDB" ? "DB 저장 시세" : result?.source === "Collectory" ? "Collectory 참고 시세" : "KREAM 참고 시세";
  const sourceActionLabel = result?.source === "KREAM" ? "KREAM 검색 열기" : "Collectory 검색 열기";

  return (
    <div className="stack">
      <section className="panel stack">
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
        {loading ? <p className="subtle">시세 데이터를 가져오는 중...</p> : null}
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
        <section className="panel stack">
          <h3>검색된 참고 데이터</h3>
          {result.listings.map((listing) => (
            <a className="listing" href={listing.url || result.searchUrl} target="_blank" rel="noreferrer" key={`${listing.title}-${listing.price}`}>
              {listing.imageUrl ? <img src={listing.imageUrl} alt="" /> : <span className="image-fallback" />}
              <span>
                <strong className="listing-title">{listing.title}</strong>
                <span className="price">{formatWon(listing.price)}</span>
              </span>
            </a>
          ))}
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
