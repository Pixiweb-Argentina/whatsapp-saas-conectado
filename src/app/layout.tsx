import type { Metadata } from "next";
import { Manrope, Instrument_Serif } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { Agentation } from "agentation";
import { brandStyleOverride } from "@/lib/branding";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});
const editorial = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-editorial",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pixiweb · Mensajería",
  description: "Espacio de atención y automatización de conversaciones",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const brand = brandStyleOverride();

  return (
    <html lang="es" suppressHydrationWarning>
      {brand && (
        <head>
          {/* Inline so the brand tint lands on first paint, before hydration. */}
          <style dangerouslySetInnerHTML={{ __html: brand }} />
        </head>
      )}
      <body
        className={`${manrope.variable} ${editorial.variable} font-body antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
          {process.env.NODE_ENV === "development" && <Agentation />}
        </ThemeProvider>
      </body>
    </html>
  );
}
