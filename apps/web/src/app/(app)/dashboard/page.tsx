export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome to Utils Plane</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="text-sm text-muted-foreground">Total Files</div>
          <div className="text-2xl font-medium mt-2">0</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="text-sm text-muted-foreground">Active Tasks</div>
          <div className="text-2xl font-medium mt-2">0</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="text-sm text-muted-foreground">Completed</div>
          <div className="text-2xl font-medium mt-2">0</div>
        </div>
      </div>
    </div>
  );
}