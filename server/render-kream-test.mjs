import http from "node:http";

const PORT = Number(process.env.PORT || 10000);
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, { ok: true, now: new Date().toISOString() });
    }

    if (req.method === "GET" && req.url?.startsWith("/api/detail")) {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const productId = url.searchParams.get("id");
      if (!productId) return sendJson(res, 400, { error: "id가 필요합니다." });
      return sendJson(res, 200, await fetchProductDetail(productId));
    }

    if (req.method !== "POST" || !req.url?.startsWith("/api/search")) {
      return sendJson(res, 404, { error: "POST /api/search 또는 GET /health만 지원합니다." });
    }

    const body = await readJson(req);
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (!query) return sendJson(res, 400, { error: "query가 필요합니다." });

    const startedAt = Date.now();
    const result = await searchKream(query);
    return sendJson(res, 200, {
      runtime: "render-node",
      query,
      elapsedMs: Date.now() - startedAt,
      ...result,
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : "알 수 없는 오류",
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Render KREAM test server listening on ${PORT}`);
});

async function searchKream(query) {
  const searchUrl = makeKreamApiSearchUrl(query);
  const response = await fetch(searchUrl, {
    headers: makeKreamApiHeaders(`https://www.kream.co.kr/search?keyword=${encodeURIComponent(query)}&tab=products`),
    signal: AbortSignal.timeout(15000),
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      contentType,
      byteLength: text.length,
      sample: text.slice(0, 300),
      listings: [],
    };
  }

  const data = JSON.parse(text);
  const products = extractProducts(data).slice(0, 8);
  const listings = await enrichProducts(products);

  return {
    ok: true,
    status: response.status,
    contentType,
    byteLength: text.length,
    productCount: products.length,
    listings,
    stats: calculateStats(listings),
  };
}

function makeKreamApiSearchUrl(keyword) {
  const params = new URLSearchParams({
    keyword,
    request_key: crypto.randomUUID().replace(/-/g, ""),
  });
  return `https://api.kream.co.kr/api/screens/search/products?${params.toString()}`;
}

function makeKreamProductApiUrl(productId) {
  const params = new URLSearchParams({
    request_key: crypto.randomUUID().replace(/-/g, ""),
  });
  return `https://api.kream.co.kr/api/p/products/${productId}?${params.toString()}`;
}

function makeKreamApiHeaders(referer) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const clientDate =
    `${now.getUTCFullYear()}` +
    `${String(now.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(now.getUTCDate()).padStart(2, "0")}` +
    `${String(now.getUTCHours()).padStart(2, "0")}` +
    `${String(now.getUTCMinutes()).padStart(2, "0")}` +
    `${String(now.getUTCSeconds()).padStart(2, "0")}+0900`;

  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
    origin: "https://kream.co.kr",
    referer,
    "user-agent": USER_AGENT,
    "x-kream-api-version": "59",
    "x-kream-client-datetime": clientDate,
    "x-kream-device-id": `web;${crypto.randomUUID()}`,
    "x-kream-web-build-version": "26.7.1",
    "x-kream-web-request-secret": "kream-djscjsghdkd",
  };
}

function extractProducts(data) {
  const listings = [];
  walk(data, (value) => {
    if (typeof value !== "string") return;
    const text = value.trim();
    if (!text.startsWith("{") || !text.includes("product_id") || !text.includes("product_name_ko")) return;

    try {
      const payload = JSON.parse(text);
      if (payload.product_id && payload.product_name_ko) {
        listings.push({
          productId: String(payload.product_id),
          title: cleanupText(payload.product_name_ko),
          price: parsePrice(payload.price),
          url: `https://www.kream.co.kr/products/${payload.product_id}`,
        });
      }
    } catch {
      // Ignore non-JSON strings.
    }
  });

  const seen = new Set();
  return listings.filter((item) => {
    if (seen.has(item.productId)) return false;
    seen.add(item.productId);
    return true;
  });
}

async function enrichProducts(products) {
  const enriched = [];
  for (const product of products) {
    enriched.push(await enrichProduct(product));
  }
  return enriched;
}

async function enrichProduct(product) {
  if (product.price) return { ...product, detail: { skipped: "price_from_search" } };

  try {
    const detailResult = await fetchProductDetail(product.productId, product.url);
    if (!detailResult.ok) return { ...product, detail: detailResult };

    const detail = detailResult.body;
    const release = detail?.release || {};
    const market = detail?.market || {};
    return {
      ...product,
      title: release.translated_name || release.name || product.title,
      price: parsePrice(market.last_sale_price) || parsePrice(market.last_price_normal) || product.price,
      imageUrl: Array.isArray(release.image_urls) ? release.image_urls[0] : undefined,
      detail: {
        ok: true,
        status: detailResult.status,
        marketKeys: Object.keys(market).slice(0, 20),
      },
    };
  } catch (error) {
    return {
      ...product,
      detail: {
        ok: false,
        error: error instanceof Error ? error.message : "알 수 없는 오류",
      },
    };
  }
}

async function fetchProductDetail(productId, referer = `https://www.kream.co.kr/products/${productId}`) {
  const startedAt = Date.now();
  try {
    const response = await fetch(makeKreamProductApiUrl(productId), {
      headers: makeKreamApiHeaders(referer),
      signal: AbortSignal.timeout(12000),
    });
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      contentType,
      byteLength: text.length,
      body: response.ok && contentType.includes("json") ? JSON.parse(text) : undefined,
      sample: response.ok ? undefined : text.slice(0, 300),
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "알 수 없는 오류",
    };
  }
}

function walk(value, visit) {
  visit(value);
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((child) => walk(child, visit));
  }
}

function parsePrice(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function calculateStats(listings) {
  const prices = listings
    .map((listing) => listing.price)
    .filter((price) => typeof price === "number" && Number.isFinite(price) && price > 0)
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

function cleanupText(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) {
        reject(new Error("요청 본문이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON 본문을 파싱하지 못했습니다."));
      }
    });
  });
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(value));
}
