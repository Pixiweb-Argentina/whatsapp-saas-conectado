export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="pixi-sidebar relative hidden flex-col justify-between p-12 lg:flex xl:p-16">
        <p className="text-3xl font-extrabold tracking-tight">pixiweb<span className="text-sidebar-active">.</span></p>
        <div className="max-w-lg py-16">
          <p className="mb-6 text-sm text-sidebar-muted">Mensajería · Atención · Automatización</p>
          <h2 className="text-5xl font-extrabold leading-tight tracking-tight xl:text-6xl">
            Cada conversación,<br /><span className="font-editorial font-normal italic text-sidebar-active">más cerca.</span>
          </h2>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-sidebar-muted">Un espacio para acompañar a tus clientes y organizar la atención de tu equipo.</p>
        </div>
        <p className="text-sm text-sidebar-muted">Tecnología con propósito.</p>
      </aside>
      <main className="flex min-w-0 flex-col items-center justify-center gap-6 px-4 py-10 sm:px-8">
        <p className="text-2xl font-extrabold tracking-tight lg:hidden">pixiweb.</p>
        {children}
      </main>
    </div>
  );
}
