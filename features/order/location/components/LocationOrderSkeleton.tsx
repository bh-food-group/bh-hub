import { Skeleton } from '@/components/ui/skeleton';

export function LocationOrderSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-10rem)] flex-col gap-3">
      {/* EtaOverview skeleton */}
      <div className="shrink-0">
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>

      {/* Main panel */}
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden rounded-lg border border-border">
        {/* Left nav */}
        <div className="flex w-52 shrink-0 flex-col border-r border-border bg-muted/30">
          {/* Search */}
          <div className="border-b border-border p-2">
            <Skeleton className="h-7 w-full rounded-md" />
          </div>
          {/* Group chips */}
          <div className="flex gap-1 border-b border-border p-2">
            <Skeleton className="h-5 w-8 rounded-full" />
            <Skeleton className="h-5 w-12 rounded-full" />
            <Skeleton className="h-5 w-10 rounded-full" />
          </div>
          {/* Sort buttons */}
          <div className="flex gap-1 border-b border-border px-2 py-1.5">
            <Skeleton className="h-6 flex-1 rounded" />
            <Skeleton className="h-6 flex-1 rounded" />
          </div>
          {/* Supplier list */}
          <div className="flex-1 space-y-0.5 overflow-hidden p-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between rounded-md px-2 py-1.5">
                <Skeleton className="h-4 w-28 rounded" />
                <Skeleton className="h-4 w-5 rounded" />
              </div>
            ))}
          </div>
        </div>

        {/* Right content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Header */}
          <div className="shrink-0 space-y-3 border-b border-border px-5 py-3">
            <div className="space-y-1">
              <Skeleton className="h-5 w-36 rounded" />
              <Skeleton className="h-3.5 w-24 rounded" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-52 rounded-md" />
              <Skeleton className="h-6 w-10 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>

          {/* PO rows */}
          <div className="flex-1 overflow-hidden px-5 py-4">
            <Skeleton className="mb-3 h-3 w-24 rounded" />
            <div className="rounded-lg border border-border bg-card">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-6 border-b border-border px-4 py-2.5 last:border-0"
                >
                  <Skeleton className="size-3.5 shrink-0 rounded" />
                  <Skeleton className="h-4 w-48 shrink-0 rounded" />
                  <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
                  <Skeleton className="h-3.5 flex-1 rounded" />
                  <div className="flex shrink-0 gap-4">
                    <div className="flex min-w-[6rem] flex-col items-end gap-1">
                      <Skeleton className="h-2.5 w-12 rounded" />
                      <Skeleton className="h-3.5 w-16 rounded" />
                    </div>
                    <div className="flex min-w-[6rem] flex-col items-end gap-1">
                      <Skeleton className="h-2.5 w-16 rounded" />
                      <Skeleton className="h-3.5 w-16 rounded" />
                    </div>
                    <div className="flex min-w-[6rem] flex-col items-end gap-1">
                      <Skeleton className="h-2.5 w-6 rounded" />
                      <Skeleton className="h-3.5 w-16 rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
