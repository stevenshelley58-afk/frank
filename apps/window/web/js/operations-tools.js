// Legacy operations shortcuts now open the native app launcher.
import { mountOwnerDashboard } from "./owner-dashboard.js?v=20260914-native-owner-apps-v1";
export const OPERATIONS_TOOLS = Object.freeze([
  { id: "inbox", name: "Mail" }, { id: "calendar", name: "Scheduling" },
  { id: "notifications", name: "Notifications" }, { id: "customers", name: "CRM" },
  { id: "email-flows", name: "Email flows" }, { id: "billing", name: "Billing" },
  { id: "analytics", name: "Reports" }, { id: "connections", name: "Connections" },
].map(tool => ({ ...tool, provider: "Native app", description: "Open the native application from Blockwise.", metrics: [], items: [] })));
export function operationsTool(id) { return OPERATIONS_TOOLS.find(tool => tool.id === id) || null; }
export function mountOperationsTool(root) { return mountOwnerDashboard(root); }
