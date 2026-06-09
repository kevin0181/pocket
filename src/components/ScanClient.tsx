"use client";

import { createWorker, PSM, type Worker } from "tesseract.js";
import { useEffect, useRef, useState } from "react";
import { PricePanel } from "@/components/PricePanel";
import { hasSearchableCardSignal, parseOcrText } from "@/lib/cardParsing";
import type { ParsedCardInfo } from "@/lib/types";

type ScanState = "idle" | "camera" | "ocr" | "needs-card" | "found" | "searching" | "done" | "error";

const STATUS: Record<ScanState, string> = {
  idle: "카메라를 준비하고 있습니다.",
  camera: "카드를 화면 중앙에 맞춰주세요.",
  ocr: "글자를 읽는 중...",
  "needs-card": "카드명과 번호가 보이게 맞춰주세요.",
  found: "카드 정보를 찾았습니다.",
  searching: "DB 저장 시세를 먼저 확인하는 중...",
  done: "시세 데이터를 표시합니다.",
  error: "카메라 또는 OCR을 사용할 수 없습니다.",
};

export function ScanClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastOcrAt = useRef(0);
  const lastSearchAt = useRef(0);
  const lastTextRef = useRef("");
  const busyRef = useRef(false);
  const [state, setState] = useState<ScanState>("idle");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [lastRawText, setLastRawText] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function boot() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 1920 } },
          audio: false,
        });
        if (!videoRef.current || cancelled) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        setState("camera");

        workerRef.current = await createWorker("kor+eng");
        await workerRef.current.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          preserve_interword_spaces: "1",
        });
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "초기화 실패");
        setState("error");
      }
    }

    boot();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      workerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    if (!cameraReady) return;
    const id = window.setInterval(() => {
      void captureAndRead();
    }, 1000);
    return () => window.clearInterval(id);
  }, [cameraReady]);

  async function captureAndRead() {
    if (busyRef.current) return;
    if (Date.now() - lastOcrAt.current < 3000) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!video || !canvas || !worker || video.readyState < 2) return;

    busyRef.current = true;
    lastOcrAt.current = Date.now();
    setState("ocr");

    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const crop = getGuideCrop(video, guideRef.current);
      const scale = getOcrScale(crop.width);
      const target = {
        width: Math.round(crop.width * scale),
        height: Math.round(crop.height * 0.52 * scale),
      };
      canvas.width = target.width;
      canvas.height = target.height;
      drawOcrBands(ctx, video, crop, scale);
      enhanceOcrCanvas(ctx, canvas.width, canvas.height);

      const result = await worker.recognize(canvas);
      const text = result.data.text.trim();
      setLastRawText(text);
      const cardInfo = parseOcrText(text);
      if (!isUsefulCardInfo(cardInfo)) {
        setState("needs-card");
        return;
      }

      setState("found");
      await searchFromOcr(text);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "OCR 실패");
      setState("error");
    } finally {
      busyRef.current = false;
    }
  }

  async function searchFromOcr(rawText: string) {
    const compact = rawText.replace(/\s+/g, " ").trim();
    if (compact === lastTextRef.current && Date.now() - lastSearchAt.current < 8000) return;
    lastTextRef.current = compact;
    lastSearchAt.current = Date.now();
    setState("searching");

    const response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText }),
    });
    const nextData = await response.json();
    if (!response.ok) throw new Error(nextData.error || "검색 실패");
    setData(nextData);
    setState("done");
  }

  return (
    <div className="scan-layout">
      <section className="camera-panel" aria-label="카메라 스캐너">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} hidden />
        <div ref={guideRef} className="guide" aria-hidden="true" />
        <div className="scan-controls">
          <button className="button primary" type="button" onClick={() => void captureAndRead()} disabled={!cameraReady || busyRef.current}>
            촬영
          </button>
        </div>
        <div className="status-pill">
          <strong>{STATUS[state]}</strong>
          {error ? <div className="subtle">{error}</div> : null}
          {lastRawText && state !== "done" ? <details className="ocr-debug"><summary>읽은 글자</summary>{lastRawText}</details> : null}
        </div>
      </section>
      <PricePanel data={data} loading={state === "searching"} />
    </div>
  );
}

function getGuideCrop(video: HTMLVideoElement, guide: HTMLDivElement | null) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!guide || !vw || !vh) {
    return {
      x: Math.round(vw * 0.12),
      y: Math.round(vh * 0.1),
      width: Math.round(vw * 0.76),
      height: Math.round(vh * 0.8),
    };
  }

  const videoRect = video.getBoundingClientRect();
  const guideRect = guide.getBoundingClientRect();
  const scale = Math.max(videoRect.width / vw, videoRect.height / vh);
  const renderedWidth = vw * scale;
  const renderedHeight = vh * scale;
  const overflowX = (renderedWidth - videoRect.width) / 2;
  const overflowY = (renderedHeight - videoRect.height) / 2;

  const x = (guideRect.left - videoRect.left + overflowX) / scale;
  const y = (guideRect.top - videoRect.top + overflowY) / scale;
  const width = guideRect.width / scale;
  const height = guideRect.height / scale;

  const sx = clamp(Math.round(x), 0, vw - 1);
  const sy = clamp(Math.round(y), 0, vh - 1);

  return {
    x: sx,
    y: sy,
    width: clamp(Math.round(width), 1, vw - sx),
    height: clamp(Math.round(height), 1, vh - sy),
  };
}

function drawOcrBands(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  crop: { x: number; y: number; width: number; height: number },
  scale = 1,
) {
  const topHeight = Math.round(crop.height * 0.28);
  const bottomHeight = Math.round(crop.height * 0.24);
  const bottomY = crop.y + crop.height - bottomHeight;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, Math.round(crop.width * scale), Math.round((topHeight + bottomHeight) * scale));
  ctx.drawImage(video, crop.x, crop.y, crop.width, topHeight, 0, 0, Math.round(crop.width * scale), Math.round(topHeight * scale));
  ctx.drawImage(
    video,
    crop.x,
    bottomY,
    crop.width,
    bottomHeight,
    0,
    Math.round(topHeight * scale),
    Math.round(crop.width * scale),
    Math.round(bottomHeight * scale),
  );
}

function isUsefulCardInfo(info: ParsedCardInfo) {
  if (info.rawText.length < 8) return false;
  return hasSearchableCardSignal(info);
}

function getOcrScale(width: number) {
  if (width < 800) return 2.2;
  if (width < 1200) return 1.7;
  return 1.3;
}

function enhanceOcrCanvas(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const boosted = Math.max(0, Math.min(255, (gray - 118) * 1.9 + 128));
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }

  ctx.putImageData(image, 0, 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
