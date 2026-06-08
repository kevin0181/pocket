import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";

export default function HomePage() {
  return (
    <main className="shell">
      <AppHeader />
      <section className="page">
        <div className="hero">
          <h1>TCG Lens KR</h1>
          <p>
            한글판 포켓몬 카드를 카메라로 비추면 카드 글자를 OCR로 읽고, KREAM 검색 데이터를 가져와 참고 시세를
            모바일 화면 안에 바로 보여줍니다.
          </p>
          <div className="nav">
            <Link className="button primary" href="/scan">
              카드 스캔하기
            </Link>
            <Link className="button" href="/search">
              직접 검색
            </Link>
          </div>
        </div>

        <div className="feature-grid">
          <div className="feature">
            <strong>모바일 카메라</strong>
            <p>후면 카메라와 카드 가이드 박스로 스캔 흐름을 시작합니다.</p>
          </div>
          <div className="feature">
            <strong>OCR 우선</strong>
            <p>카드명, 번호, 레어도를 텍스트로 읽고 검색어 후보를 만듭니다.</p>
          </div>
          <div className="feature">
            <strong>KREAM provider</strong>
            <p>가격 수집과 필터링을 별도 모듈로 분리해 유지보수하기 쉽게 구성했습니다.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
