import { Bot, Plus, ShieldCheck } from "lucide-react";
import { DataTable, EmptyState, SectionCard, StatusBadge } from "../components/dashboard/index.js";
import { Button } from "../components/ui/index.js";

const agentSurfaces = [
  { name: "Approval review", boundary: "Human-gated decisions", status: "planned" as const },
  { name: "Project context", boundary: "Workspace summaries", status: "planned" as const },
  { name: "Worker queue", boundary: "Background jobs", status: "planned" as const }
];

export function AgentsPage() {
  return (
    <section className="grid gap-5">
      <SectionCard
        title="Agent Registry"
        description="Agent surfaces are scaffolded here before runtime wiring is added."
        icon={<Bot aria-hidden="true" />}
        action={
          <Button variant="outline" size="sm" disabled>
            <Plus aria-hidden="true" />
            Register
          </Button>
        }
      >
        <DataTable
          data={agentSurfaces}
          getRowId={(row) => row.name}
          columns={[
            {
              id: "name",
              header: "Surface",
              cell: (row) => <span className="font-semibold text-foreground">{row.name}</span>
            },
            {
              id: "boundary",
              header: "Boundary",
              cell: (row) => <span className="text-muted-foreground">{row.boundary}</span>
            },
            {
              id: "status",
              header: "Status",
              className: "text-right",
              cell: (row) => <StatusBadge tone={row.status} />
            }
          ]}
        />
      </SectionCard>

      <EmptyState
        icon={<ShieldCheck aria-hidden="true" />}
        title="No active agent runtimes"
        description="Frank Hub is keeping this foundation dashboard-first until agent runtime controls are intentionally added."
      />
    </section>
  );
}
