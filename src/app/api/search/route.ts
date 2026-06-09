import { NextResponse } from "next/server";
import { buildKreamQueries, hasSearchableCardSignal, parseManualQuery, parseOcrText } from "@/lib/cardParsing";
import { searchCollectory } from "@/lib/collectoryProvider";
import { searchCollectoryDatabase } from "@/lib/databaseProvider";
import { getCachedResult, setCachedResult } from "@/lib/searchCache";
import { searchKream } from "@/lib/kreamProvider";

export const preferredRegion = "icn1";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { query?: string; rawText?: string } | null;

  if (!body?.query && !body?.rawText) {
    return NextResponse.json({ error: "query 또는 rawText가 필요합니다." }, { status: 400 });
  }

  const cardInfo = body.rawText ? parseOcrText(body.rawText) : parseManualQuery(body.query || "");

  if (body.rawText && !hasSearchableCardSignal(cardInfo)) {
    return NextResponse.json(
      {
        cardInfo,
        queries: [],
        error: "카드명과 카드번호 또는 레어도가 충분히 읽히지 않았습니다.",
      },
      { status: 422 },
    );
  }

  const queries = body.query ? [body.query.trim(), ...buildKreamQueries(cardInfo)] : buildKreamQueries(cardInfo);
  const uniqueQueries = Array.from(new Set(queries.filter(Boolean)));
  const collectoryQueries = Array.from(new Set([cardInfo.cardName, ...uniqueQueries].filter((query) => query.trim().length >= 2)));

  const tried = [];
  for (const query of collectoryQueries) {
    const dbResult = await searchCollectoryDatabase(query, cardInfo);
    if (dbResult) {
      tried.push(dbResult);
      if (dbResult.listings.length > 0) {
        return NextResponse.json({ cardInfo, queries: uniqueQueries, result: dbResult });
      }
    }
  }

  for (const query of [...collectoryQueries, ...uniqueQueries]) {
    const cached = getCachedResult(query);
    if (cached && cached.listings.length > 0) {
      return NextResponse.json({ cardInfo, queries: uniqueQueries, result: cached });
    }
  }

  for (const query of collectoryQueries) {
    const collectoryResult = await searchCollectory(query, cardInfo);
    setCachedResult(query, collectoryResult);
    tried.push(collectoryResult);
    if (collectoryResult.listings.length > 0) {
      return NextResponse.json({ cardInfo, queries: uniqueQueries, result: collectoryResult });
    }
  }

  for (const query of uniqueQueries) {
    const result = await searchKream(query, cardInfo);
    setCachedResult(query, result);
    tried.push(result);
    if (result.listings.length > 0) {
      return NextResponse.json({ cardInfo, queries: uniqueQueries, result });
    }
  }

  return NextResponse.json({ cardInfo, queries: uniqueQueries, result: tried[0] });
}
