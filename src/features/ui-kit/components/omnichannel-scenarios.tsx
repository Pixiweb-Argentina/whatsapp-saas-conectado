"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function RulePreview() {
  const [keyword, setKeyword] = useState("hola");
  const [comment, setComment] = useState("");
  const [result, setResult] = useState("");
  function simulate() {
    const matches = keyword.trim() && comment.trim().toLocaleLowerCase() === keyword.trim().toLocaleLowerCase();
    setResult(matches ? "Coincide. La guía quedaría pendiente de verificar permisos y política de respuesta privada." : "No coincide con la palabra completa. No se prepara una respuesta.");
  }
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Comentario → guía</CardTitle><CardDescription>Instagram · Publicación de ejemplo · Borrador</CardDescription></CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2"><Label htmlFor="rule-word">Palabra del comentario</Label><Input id="rule-word" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></div>
        <div className="rounded-lg bg-muted p-4 text-sm"><p className="font-semibold">Respuesta privada propuesta</p><p className="mt-2">¡Hola! Acá tenés la guía que pediste.</p><p className="mt-2 text-muted-foreground">Guía de ejemplo · enlace pendiente</p></div>
        <div className="space-y-2"><Label htmlFor="rule-comment">Probá un comentario</Label><Input id="rule-comment" placeholder='Escribí "hola"' value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        <Button onClick={simulate} disabled={!keyword.trim() || !comment.trim()}>Simular coincidencia</Button>
        {result && <p role="status" className="rounded-lg border border-border/40 bg-muted p-4 text-sm">{result}</p>}
        <p className="text-xs text-muted-foreground">Simulación visual local. No activa automatizaciones ni contacta a Meta.</p>
      </CardContent>
    </Card>
  );
}

export function ConnectionPreview() {
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Conectar Instagram</CardTitle><CardDescription>@estudio.ejemplo · cuenta ficticia</CardDescription></CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-3 rounded-lg border border-warning/50 bg-warning/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div><p className="text-sm font-bold">Faltan permisos</p><p className="mt-1 text-sm">Para responder comentarios, necesitás autorizar el acceso a los comentarios de esta cuenta.</p></div>
        </div>
        <ul className="space-y-4 text-sm">
          <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />Cuenta seleccionada · ejemplo</li>
          <li className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />Comentarios · permiso pendiente</li>
          <li className="text-muted-foreground">Recepción y envío: todavía sin verificar</li>
        </ul>
        <Button disabled>Revisar permisos</Button>
        <p className="text-xs text-muted-foreground">Vista de diseño. La conexión real estará disponible en la fase de Instagram.</p>
      </CardContent>
    </Card>
  );
}

export function CrmConflictPreview() {
  const [choice, setChoice] = useState("");
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Revisá este cambio</CardTitle><CardDescription>Brevo · Contacto de ejemplo · Conflicto de teléfono</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm">El mismo campo cambió en ambos lugares. Elegí qué valor conservar antes de sincronizar.</p>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Valor a conservar</legend>
          {["Valor del SaaS", "Valor de Brevo"].map((option, index) => (
            <label key={option} className="flex cursor-pointer gap-3 rounded-lg border border-input p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/10">
              <input type="radio" name="crm-choice" value={option} checked={choice === option} onChange={() => setChoice(option)} className="mt-1 accent-primary" />
              <span className="text-sm"><span className="block font-bold">{option}</span><span className="mt-2 block font-mono">•••• {index ? "4821" : "7310"}</span></span>
            </label>
          ))}
        </fieldset>
        <p role="status" className="text-sm text-muted-foreground">{choice ? `Selección local: ${choice}. No se sincronizó ningún dato.` : "Ningún valor seleccionado."}</p>
        <Button disabled>Confirmar y sincronizar</Button>
      </CardContent>
    </Card>
  );
}

export function WidgetPreview() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex min-h-[520px] flex-col justify-end rounded-xl border border-border/40 bg-muted p-4 sm:p-8">
      <p className="absolute left-5 top-5 text-sm text-muted-foreground">Sitio del cliente · ejemplo de integración</p>
      {open && <section aria-label="Chat web de ejemplo" className="ml-auto mb-4 w-full max-w-sm overflow-hidden rounded-xl border border-border/40 bg-card shadow-sm">
        <header className="flex items-center justify-between gap-2 bg-primary p-5 text-primary-foreground"><h3 className="font-bold">Hablemos</h3><Badge variant="outline" className="border-current text-inherit">Demo</Badge></header>
        <div className="space-y-4 p-5"><p className="font-editorial text-3xl italic">Te damos la bienvenida.</p><p className="text-sm">Contanos qué necesitás y te ayudamos a encontrar el próximo paso.</p><Input disabled aria-label="Consulta de ejemplo" placeholder="Escribí tu consulta" /><p className="text-xs text-muted-foreground">Vista de diseño. No inicia una sesión ni envía datos.</p></div>
      </section>}
      <Button onClick={() => setOpen(!open)} className="ml-auto rounded-full" aria-expanded={open}><MessageCircle aria-hidden="true" />{open ? "Cerrar chat" : "Abrir chat"}</Button>
    </div>
  );
}
