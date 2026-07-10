/** Skeleton loader for suggestion sections (NFR §9.1: cart-level async). */
export default function SuggestionsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 small:grid-cols-3 large:grid-cols-5 gap-x-4 gap-y-6">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="animate-pulse rounded-lg border border-ui-border-base p-2"
        >
          <div className="aspect-square w-full rounded-md bg-ui-bg-component" />
          <div className="mt-2 h-3 w-3/4 rounded bg-ui-bg-component" />
          <div className="mt-1 h-3 w-1/2 rounded bg-ui-bg-component" />
          <div className="mt-2 h-7 w-full rounded-md bg-ui-bg-component" />
        </li>
      ))}
    </ul>
  )
}
