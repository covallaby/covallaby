import { Card } from "./ui.js";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-(--surface-2) ${className}`} />;
}

/** Placeholder for a hero + chart + table page while data loads. */
export function PageSkeleton() {
  return (
    <div>
      <div className="mb-6">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-3 h-12 w-44" />
        <Skeleton className="mt-4 h-1.5 w-72 rounded-full" />
      </div>
      <Card className="p-4">
        <Skeleton className="h-56 w-full" />
      </Card>
      <Card className="mt-4 space-y-3 p-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </Card>
    </div>
  );
}
