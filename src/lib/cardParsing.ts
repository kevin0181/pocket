import type { ParsedCardInfo } from "@/lib/types";

const RARITIES = ["SAR", "RRR", "SR", "AR", "UR", "RR", "R", "U", "C"];
const NOISE_PATTERNS = [
  /^HP\s*\d+/i,
  /^\d+\s*$/,
  /^(약점|저항력|후퇴|기술|특성)/,
  /^[A-Z]{1,2}\s*$/,
];
const CARD_NUMBER_PATTERN = /\b\d{1,3}\s*\/\s*\d{1,3}\b/;

export function parseOcrText(rawText: string): ParsedCardInfo {
  const normalized = rawText
    .replace(/\r/g, "\n")
    .replace(/[|｜]/g, "/")
    .replace(/\s+\/\s+/g, "/")
    .trim();

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const cardNumber = normalizeCardNumber(normalized.match(CARD_NUMBER_PATTERN)?.[0]);
  const rarity = findRarity(normalized);
  const cardName = findCardName(lines, cardNumber, rarity);

  return {
    cardName,
    cardNumber,
    rarity,
    rawText: normalized,
    language: /[가-힣]/.test(normalized) ? "ko" : "unknown",
  };
}

export function buildKreamQueries(info: ParsedCardInfo | { cardName: string; cardNumber?: string; rarity?: string }) {
  const name = info.cardName.trim();
  const queries = [
    [name, info.cardNumber, info.rarity, "한글판"].filter(Boolean).join(" "),
    [name, info.rarity, "한글판"].filter(Boolean).join(" "),
    ["포켓몬카드", name, info.cardNumber].filter(Boolean).join(" "),
    ["포켓몬카드", name, "한글판"].filter(Boolean).join(" "),
  ];

  return Array.from(new Set(queries.filter((query) => query.trim().length >= 2)));
}

export function parseManualQuery(query: string) {
  const rawText = query.trim();
  const cardNumber = normalizeCardNumber(rawText.match(CARD_NUMBER_PATTERN)?.[0]);
  const rarity = findRarity(rawText);
  const cardName = rawText
    .replace(CARD_NUMBER_PATTERN, "")
    .replace(/\b(SAR|RRR|SR|AR|UR|RR|R|U|C)\b/gi, "")
    .replace(/한글판|포켓몬카드/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return parseOcrText([cardName || rawText, cardNumber, rarity].filter(Boolean).join("\n"));
}

export function hasSearchableCardSignal(info: ParsedCardInfo) {
  const name = info.cardName.replace(/\s+/g, "");
  return /[가-힣]{2,}/.test(name) && Boolean(info.cardNumber || info.rarity);
}

function findRarity(text: string) {
  const upper = text.toUpperCase();
  return RARITIES.find((rarity) => new RegExp(`\\b${rarity}\\b`).test(upper));
}

function findCardName(lines: string[], cardNumber?: string, rarity?: string) {
  const candidates = lines.map(cleanCardNameCandidate).filter((line) => {
    if (cardNumber && line.includes(cardNumber)) return false;
    if (rarity && line.toUpperCase() === rarity) return false;
    if (NOISE_PATTERNS.some((pattern) => pattern.test(line))) return false;
    return /[가-힣]{2,}/.test(line) || /\b(ex|gx|vmax|vstar|v)\b/i.test(line);
  });

  return candidates[0]?.replace(/\s+/g, " ").trim() || lines[0]?.replace(/\s+/g, " ").trim() || "";
}

function cleanCardNameCandidate(line: string) {
  const withoutNumber = line.replace(CARD_NUMBER_PATTERN, " ");
  const beforeNoise = withoutNumber
    .split(/\/\/|[\\/]{2,}|BD|HP\s*\d+|TR\s*:|We\s|Coad|Shot|사용할 수 있다|[=<>"]/i)[0]
    .replace(/[^\p{Script=Hangul}\p{Script=Latin}\d\s-]/gu, " ")
    .replace(/\b[A-Z]{2,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const koreanMatch = beforeNoise.match(/[가-힣][가-힣\s]{1,18}(?:\s(?:ex|EX|V|GX|VMAX|VSTAR))?/);
  return (koreanMatch?.[0] || beforeNoise).trim();
}

function normalizeCardNumber(value?: string) {
  if (!value) return undefined;
  const [rawLeft, rawRight] = value.replace(/\s/g, "").split("/");
  if (!rawLeft || !rawRight) return undefined;

  let left = rawLeft;
  let right = rawRight;
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (left.length === 3 && right.length <= 2 && leftNumber > rightNumber && left.endsWith("0")) {
    left = `0${left.slice(0, 2)}`;
  }

  if (right.length === 2 && left.length === 3) {
    right = `0${right}`;
  }

  return `${left}/${right}`;
}
