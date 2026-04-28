import { Boxes, Route } from "lucide-react";
import { MODEL_ROLES } from "@frank/shared";
import { DataTable, KeyValueList, SectionCard, StatusBadge } from "../components/dashboard/index.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/index.js";

const roleRows = MODEL_ROLES.map((role) => ({
  role,
  label: role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}));

export function ModelsPage() {
  return (
    <Tabs defaultValue="roles" className="grid gap-5">
      <TabsList className="w-fit">
        <TabsTrigger value="roles">Roles</TabsTrigger>
        <TabsTrigger value="routing">Routing</TabsTrigger>
      </TabsList>

      <TabsContent value="roles" className="mt-0">
        <SectionCard
          title="Model Roles"
          description="Agents request model roles, keeping provider and model selection outside agent logic."
          icon={<Boxes aria-hidden="true" />}
        >
          <DataTable
            data={roleRows}
            getRowId={(row) => row.role}
            columns={[
              {
                id: "role",
                header: "Role",
                cell: (row) => <span className="font-semibold text-foreground">{row.label}</span>
              },
              {
                id: "id",
                header: "Identifier",
                cell: (row) => <code className="rounded-sm bg-muted px-1.5 py-1 text-xs text-muted-foreground">{row.role}</code>
              },
              {
                id: "status",
                header: "Status",
                className: "text-right",
                cell: () => <StatusBadge tone="neutral">Registered</StatusBadge>
              }
            ]}
          />
        </SectionCard>
      </TabsContent>

      <TabsContent value="routing" className="mt-0">
        <SectionCard
          title="Routing Policy"
          description="The current foundation exposes routing posture without runtime provider calls."
          icon={<Route aria-hidden="true" />}
        >
          <KeyValueList
            items={[
              { label: "Mode", value: "Role-based skeleton" },
              { label: "Provider calls", value: "Disabled" },
              { label: "Runtime adapters", value: "Not wired" },
              { label: "Agent contract", value: "Request roles, not concrete models" }
            ]}
          />
        </SectionCard>
      </TabsContent>
    </Tabs>
  );
}
