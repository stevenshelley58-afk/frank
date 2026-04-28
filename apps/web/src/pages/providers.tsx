import { PlugZap } from "lucide-react";
import { PROVIDER_IDS } from "@frank/shared";
import { DataTable, SectionCard, StatusBadge } from "../components/dashboard/index.js";

const providerRows = PROVIDER_IDS.map((provider) => ({
  id: provider,
  label: provider
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}));

export function ProvidersPage() {
  return (
    <SectionCard
      title="Provider Registry"
      description="Provider identifiers are visible for configuration planning; runtime calls remain disabled."
      icon={<PlugZap aria-hidden="true" />}
    >
      <DataTable
        data={providerRows}
        getRowId={(row) => row.id}
        columns={[
          {
            id: "provider",
            header: "Provider",
            cell: (row) => <span className="font-semibold text-foreground">{row.label}</span>
          },
          {
            id: "id",
            header: "Identifier",
            cell: (row) => <code className="rounded-sm bg-muted px-1.5 py-1 text-xs text-muted-foreground">{row.id}</code>
          },
          {
            id: "status",
            header: "Status",
            className: "text-right",
            cell: () => <StatusBadge tone="planned" />
          }
        ]}
      />
    </SectionCard>
  );
}
