import Link from "next/link";

export function AppHeader() {
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <strong>TCG Lens KR</strong>
        <span>Pokemon card market scanner</span>
      </Link>
      <nav className="nav" aria-label="주요 메뉴">
        <Link className="button" href="/scan">
          스캔
        </Link>
        <Link className="button" href="/search">
          검색
        </Link>
      </nav>
    </header>
  );
}
