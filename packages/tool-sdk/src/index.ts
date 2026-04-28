export type ToolRisk = "read" | "write" | "destructive" | "host";
export type PermissionDecision = "allow" | "deny" | "approval_required";

export interface ToolRequest {
  toolName: string;
  risk: ToolRisk;
  actorId: string;
  target?: string;
  reason?: string;
}

export interface ToolPolicyResult {
  decision: PermissionDecision;
  reason: string;
}

export interface ToolPermissionPolicy {
  evaluate(request: ToolRequest): ToolPolicyResult;
}

export const foundationToolPolicy: ToolPermissionPolicy = {
  evaluate(request) {
    if (request.risk === "destructive" || request.risk === "host") {
      return {
        decision: "deny",
        reason: "Foundation policy denies destructive and unrestricted host operations by default."
      };
    }

    if (request.risk === "write") {
      return {
        decision: "approval_required",
        reason: "Write operations require dashboard approval in the No-terminal Ops Console skeleton."
      };
    }

    return {
      decision: "allow",
      reason: "Read-only operation allowed by the foundation policy."
    };
  }
};

export interface OpsConsoleAction {
  id: string;
  label: string;
  risk: ToolRisk;
  enabled: false;
  requiresApproval: true;
}

export const noTerminalOpsConsoleSkeleton: OpsConsoleAction[] = [
  {
    id: "deploy.preview",
    label: "Preview deployment status",
    risk: "read",
    enabled: false,
    requiresApproval: true
  },
  {
    id: "service.restart.request",
    label: "Request service restart",
    risk: "write",
    enabled: false,
    requiresApproval: true
  },
  {
    id: "host.command.blocked",
    label: "Host command execution",
    risk: "host",
    enabled: false,
    requiresApproval: true
  }
];
