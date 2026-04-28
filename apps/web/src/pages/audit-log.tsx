import { FileClock, Search } from "lucide-react";
import { DataTable, EmptyState, SectionCard } from "../components/dashboard/index.js";
import { Alert, AlertDescription, AlertTitle, Input } from "../components/ui/index.js";

export function AuditLogPage() {
  return (
    <section className="grid gap-5">
      <Alert>
        <AlertTitle>Audit log foundation</AlertTitle>
        <AlertDescription>
          Startup writes are enabled in the backend; dashboard log streaming can be connected when the API endpoint is ready.
        </AlertDescription>
      </Alert>

      <SectionCard
        title="Events"
        description="A reusable table surface for operational audit records."
        icon={<FileClock aria-hidden="true" />}
        action={
          <div className="relative w-56 max-w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-9" placeholder="Search events" disabled />
          </div>
        }
      >
        <DataTable
          data={[]}
          getRowId={(_, index) => String(index)}
          columns={[
            { id: "time", header: "Time", cell: () => null },
            { id: "actor", header: "Actor", cell: () => null },
            { id: "event", header: "Event", cell: () => null },
            { id: "status", header: "Status", cell: () => null }
          ]}
          emptyState={
            <EmptyState
              icon={<FileClock aria-hidden="true" />}
              title="No audit events loaded"
              description="This page is scaffolded for API-backed audit rows without inventing local event data."
            />
          }
        />
      </SectionCard>
    </section>
  );
}
