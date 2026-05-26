import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function RevenueCardSkeleton() {
  return (
    <Card className="min-w-0 gap-2">
      <CardHeader className="pb-1">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-2 h-[80px] w-full rounded-md" />
      </CardContent>
    </Card>
  );
}

function WeeklyCardSkeleton() {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-28" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-1.5 rounded-lg border border-dashed border-muted/60 bg-muted/20 p-2 pt-6" style={{ minHeight: 160 }}>
          {[42, 58, 48, 66, 52, 72, 45].map((pct, i) => (
            <Skeleton
              key={i}
              className="w-full min-w-0 rounded-sm"
              style={{ height: `${pct}%` }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function BudgetSkeleton() {
  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-6 w-24" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="mx-auto flex aspect-square max-h-[200px] items-center justify-center rounded-lg bg-muted/50">
          <Skeleton className="size-16 rounded-full" />
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function LaborSkeleton() {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-20" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-[120px] w-full rounded-md" />
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export default function DashboardCardsSkeleton() {
  return (
    <div className="grid gap-4 max-lg:grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex gap-4 [&>*]:flex-1">
          <RevenueCardSkeleton />
          <RevenueCardSkeleton />
        </div>
        <WeeklyCardSkeleton />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <BudgetSkeleton />
        <LaborSkeleton />
      </div>
    </div>
  );
}
