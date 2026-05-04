export type ToolRisk = "read" | "write" | "destructive" | "host";
export type PermissionDecision = "allow" | "deny" | "approval_required";
export type OperatorMode = "lab" | "guarded" | "production";

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

export interface OperatorToolPolicyConfig {
  mode: OperatorMode;
  protectedTargets: string[];
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

export function createOperatorToolPolicy(config: OperatorToolPolicyConfig): ToolPermissionPolicy {
  return {
    evaluate(request) {
      if (isProtectedTarget(request.target, config.protectedTargets)) {
        return {
          decision: "deny",
          reason: "Operator policy denies access to protected Frank targets."
        };
      }

      if (request.risk === "read") {
        return {
          decision: "allow",
          reason: "Read-only operation allowed."
        };
      }

      if (config.mode === "lab") {
        return {
          decision: "allow",
          reason: "Lab operator mode allows broad VPS work outside protected targets."
        };
      }

      if (request.risk === "write") {
        return {
          decision: "approval_required",
          reason: "Guarded and production modes require approval for writes."
        };
      }

      return {
        decision: "deny",
        reason: "Guarded and production modes deny destructive and unrestricted host operations."
      };
    }
  };
}

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

function isProtectedTarget(target: string | undefined, protectedTargets: string[]): boolean {
  if (!target?.trim()) {
    return false;
  }

  const normalizedTarget = normalizeTarget(target);
  return protectedTargets.some((protectedTarget) => {
    const normalizedProtected = normalizeTarget(protectedTarget);
    if (!normalizedProtected) {
      return false;
    }
    if (normalizedProtected === "/") {
      return normalizedTarget === "/";
    }
    return normalizedTarget === normalizedProtected || normalizedTarget.startsWith(`${normalizedProtected}/`);
  });
}

function normalizeTarget(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalized || "/";
}
