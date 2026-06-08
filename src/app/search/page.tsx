import { AppHeader } from "@/components/AppHeader";
import { SearchClient } from "@/components/SearchClient";

export default function SearchPage() {
  return (
    <main className="shell">
      <AppHeader />
      <section className="page">
        <SearchClient />
      </section>
    </main>
  );
}
