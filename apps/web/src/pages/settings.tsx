import { LockKeyhole, Settings, ShieldCheck } from "lucide-react";
import { FRANK_API_URL, FRANK_DASHBOARD_URL } from "@frank/shared";
import { KeyValueList, SectionCard } from "../components/dashboard/index.js";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "../components/ui/index.js";

export function SettingsPage() {
  return (
    <Tabs defaultValue="general" className="grid gap-5">
      <TabsList className="w-fit">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="access">Access</TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="mt-0">
        <SectionCard
          title="Dashboard Settings"
          description="Public endpoints and default operator view."
          icon={<Settings aria-hidden="true" />}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold text-foreground">
              Dashboard URL
              <Input value={FRANK_DASHBOARD_URL} readOnly />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-foreground">
              API URL
              <Input value={FRANK_API_URL} readOnly />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-foreground">
              Default View
              <Select defaultValue="dashboard">
                <SelectTrigger>
                  <SelectValue placeholder="Select view" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dashboard">Dashboard</SelectItem>
                  <SelectItem value="agents">Agents</SelectItem>
                  <SelectItem value="models">Models</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        </SectionCard>
      </TabsContent>

      <TabsContent value="access" className="mt-0">
        <SectionCard
          title="Access Guardrails"
          description="Deployment and runtime restrictions kept visible in the operator UI."
          icon={<LockKeyhole aria-hidden="true" />}
          action={
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <ShieldCheck aria-hidden="true" />
                  Review
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Operational guardrails</DialogTitle>
                  <DialogDescription>
                    Frank Hub keeps normal operation dashboard-first and fails closed when a control is not ready.
                  </DialogDescription>
                </DialogHeader>
                <KeyValueList
                  items={[
                    { label: "Production deploys", value: "Manual approval only" },
                    { label: "Secrets", value: "Never committed" },
                    { label: "Terminal operations", value: "Disabled in normal operation" }
                  ]}
                />
                <DialogFooter>
                  <Button type="button">Understood</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        >
          <KeyValueList
            items={[
              { label: "Cloudflare Access", value: "Required" },
              { label: "Cloudflare Tunnel", value: "frank-hub-vps" },
              { label: "Backend platform", value: "VPS Fastify service" },
              { label: "Frontend platform", value: "Static Vite SPA" }
            ]}
          />
        </SectionCard>
      </TabsContent>
    </Tabs>
  );
}
