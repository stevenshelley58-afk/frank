export type HomeSelectionKind = "chat" | "task" | "upcoming" | "project" | "library" | "skills" | "rules" | "sent-task";

export interface HomeSelection {
  kind: HomeSelectionKind;
  title: string;
  subtitle?: string | undefined;
  id?: string | undefined;
}
