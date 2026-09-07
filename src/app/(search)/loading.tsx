/**
 * Scoped to the search route group on purpose. A `loading.tsx` at the app root
 * is the nearest one for EVERY route, so this results-shaped skeleton used to
 * flash on /credits, /library and /login too — a search page materialising for
 * half a second in front of a sign-in form. The route group keeps the skeleton
 * with the page it describes without changing any URL.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <div className="bg-surface-2 h-6 w-64 animate-pulse rounded-full motion-reduce:animate-none" />

      <div
        role="status"
        aria-label="Loading search results"
        className="flex w-full flex-col gap-3 sm:flex-row sm:gap-8"
      >
        <div className="hidden w-56 shrink-0 flex-col gap-3 sm:flex">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface h-20 animate-pulse rounded-xl motion-reduce:animate-none"
            />
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="border-line bg-surface h-32 animate-pulse rounded-xl border motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
