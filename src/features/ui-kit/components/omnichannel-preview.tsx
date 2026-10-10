"use client";

import { useState } from "react";
import Link from "next/link";
import { AppFrame } from "@/shared/components/app-frame";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { OmnichannelInboxPreview } from "./omnichannel-inbox-preview";
import { ConnectionPreview, CrmConflictPreview, RulePreview, WidgetPreview } from "./omnichannel-scenarios";

const VIEWS = ["Inbox", "Regla «hola»", "Conexión", "Conflicto Brevo", "Widget"] as const;

export function OmnichannelPreview() {
  const [view, setView] = useState<(typeof VIEWS)[number]>("Inbox");
  return (
    <AppFrame pathname="/inbox" isSuperAdmin={false} workspace="Espacio de ejemplo" actions={<ThemeToggle />}>
      <main className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:p-8">
        <header className="space-y-3">
          <Link href="/ui" className="text-sm text-primary underline underline-offset-4">Biblioteca de componentes</Link>
          <h1 className="text-3xl font-extrabold tracking-tight">Tu atención, <span className="font-editorial font-normal italic">en un lugar.</span></h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Vista de diseño · Datos ficticios. Los canales y Brevo todavía no están conectados.</p>
        </header>
        <div role="group" aria-label="Vista de diseño" className="flex flex-wrap gap-2">
          {VIEWS.map((name) => <Button key={name} variant={view === name ? "default" : "outline"} aria-pressed={view === name} onClick={() => setView(name)}>{name}</Button>)}
        </div>
        {view === "Inbox" && <OmnichannelInboxPreview />}
        {view === "Regla «hola»" && <RulePreview />}
        {view === "Conexión" && <ConnectionPreview />}
        {view === "Conflicto Brevo" && <CrmConflictPreview />}
        {view === "Widget" && <WidgetPreview />}
      </main>
    </AppFrame>
  );
}
