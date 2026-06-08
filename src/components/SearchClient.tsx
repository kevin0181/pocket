"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { PricePanel } from "@/components/PricePanel";
import { makeBookmarklet } from "@/lib/bookmarklet";
import { parseManualQuery } from "@/lib/cardParsing";
import { calculateStats } from "@/lib/priceStats";
import type { KreamListing, PriceResult } from "@/lib/types";

type SearchResponse = {
  cardInfo: ReturnType<typeof parseManualQuery>;
  queries: string[];
  result: PriceResult;
};

type KreamImportPayload = {
  query?: string;
  listings?: KreamListing[];
  collectedAt?: string;
  searchUrl?: string;
};

export function SearchClient() {
  const [query, setQuery] = useState("리자몽 ex 134/108 SAR 한글판");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const bookmarkletHref = useMemo(() => makeBookmarklet(origin || "https://poket-mu.vercel.app"), [origin]);

  useEffect(() => {
    setOrigin(window.location.origin);
    const imported = new URLSearchParams(window.location.search).get("import");
    if (!imported) return;

    try {
      const payload = decodeImportPayload(imported);
      const importedQuery = payload.query?.trim() || "KREAM 가져오기";
      const listings = Array.isArray(payload.listings) ? payload.listings : [];
      const collectedAt = payload.collectedAt || new Date().toISOString();
      setQuery(importedQuery);
      setData({
        cardInfo: parseManualQuery(importedQuery),
        queries: [importedQuery],
        result: {
          query: importedQuery,
          source: "KREAM",
          stats: calculateStats(listings),
          listings,
          collectedAt,
          cached: false,
          searchUrl: payload.searchUrl || makeKreamSearchUrl(importedQuery),
          warnings: listings.some((listing) => listing.price)
            ? []
            : ["KREAM 화면에서 상품은 읽었지만 가격은 표시되지 않았습니다."],
        },
      });
    } catch {
      setError("KREAM 가져오기 데이터를 읽지 못했습니다.");
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const nextData = await response.json();
      if (!response.ok) throw new Error(nextData.error || "검색 실패");
      setData(nextData);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "검색 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="scan-layout">
      <section className="panel stack">
        <h1>직접 검색</h1>
        <p className="subtle">OCR이 틀렸을 때 카드명, 번호, 레어도를 직접 넣어 KREAM 참고 시세를 확인합니다.</p>
        <form className="search-form" onSubmit={submit}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="검색어" />
          <button className="button primary" disabled={loading}>
            검색
          </button>
        </form>
        <div className="action-row">
          <a className="button" href={makeKreamSearchUrl(query)} target="_blank" rel="noreferrer">
            KREAM 열기
          </a>
          <button className="button" type="button" onClick={() => copyBookmarklet(bookmarkletHref, setCopied)}>
            {copied ? "복사됨" : "북마클릿 복사"}
          </button>
        </div>
        <textarea className="bookmarklet-box" readOnly value={bookmarkletHref} aria-label="북마클릿 코드" />
        {error ? <p className="subtle">{error}</p> : null}
      </section>
      <PricePanel data={data} loading={loading} />
    </div>
  );
}

function makeKreamSearchUrl(query: string) {
  const params = new URLSearchParams({ keyword: query, tab: "products" });
  return `https://www.kream.co.kr/search?${params.toString()}`;
}

function decodeImportPayload(value: string): KreamImportPayload {
  return JSON.parse(decodeURIComponent(escape(atob(value)))) as KreamImportPayload;
}

async function copyBookmarklet(value: string, setCopied: (copied: boolean) => void) {
  await navigator.clipboard.writeText(value);
  setCopied(true);
  window.setTimeout(() => setCopied(false), 1600);
}
