import type { Metadata } from "next";
import GraphConsolePage from "./graph-console";

export const metadata: Metadata = {
  title: "FRANK — Code Graph",
  description: "Live structural map of every registered codebase.",
};

export default function Page() {
  return <GraphConsolePage />;
}
