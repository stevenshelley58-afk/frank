# Frank Hub Web

This app is the static Vite React frontend for Frank Hub. It stays dashboard-first and uses a small shadcn/ui-style component system rather than a framework template.

## Component Structure

- `src/components/ui`: reusable primitives such as `Button`, `Input`, `Select`, `Badge`, `Card`, `Tabs`, `Dialog`, `Table`, `Alert`, and `Skeleton`.
- `src/components/dashboard`: composed dashboard components such as `StatCard`, `StatusBadge`, `SectionCard`, `KeyValueList`, `HealthCheckRow`, `DataTable`, and `EmptyState`.
- `src/components/layout`: app-level shell components. `AppShell` owns the sidebar, topbar, and responsive content area.
- `src/pages`: route-level screens for Dashboard, Agents, Models, Providers, Audit Log, and Settings.
- `src/styles.css`: Tailwind import plus central Frank Hub theme tokens for color, radius, spacing, typography, and layout constants.

Pages should compose existing primitives and dashboard components first. Add new components only when styling or behavior is reused across screens.
