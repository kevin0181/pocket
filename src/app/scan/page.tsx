import { AppHeader } from "@/components/AppHeader";
import { ScanClient } from "@/components/ScanClient";

export default function ScanPage() {
  return (
    <main className="shell">
      <AppHeader />
      <section className="page scan-page">
        <ScanClient />
      </section>
    </main>
  );
}
