export function OfflinePageContent() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <section className="w-full max-w-md border-l border-border pl-6 text-left">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Utils-Plane
        </p>
        <h1 className="mt-3 text-2xl font-semibold">You are offline</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Some local tools remain available offline.
        </p>
      </section>
    </main>
  );
}
