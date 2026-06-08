"use client";

import { FormEvent, useState } from "react";
import { PricePanel } from "@/components/PricePanel";

export function SearchClient() {
  const [query, setQuery] = useState("리자몽 ex 134/108 SAR 한글판");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
        {error ? <p className="subtle">{error}</p> : null}
      </section>
      <PricePanel data={data} loading={loading} />
    </div>
  );
}
