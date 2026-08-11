'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ChevronDown } from '@/components/ui/icons';
import { useAuth } from '@/components/providers';

/* ------------------------------------------------------------------ */
/* Tasks console — Frank's work board (API) + Plane + Google Tasks.    */
/* Track A2: shadcn data-table (sorting, filtering, column visibility, */
/* row selection) on the existing /v1/work data source — no API change.*/
/* ------------------------------------------------------------------ */

interface WorkItem {
  id: string;
  title: string;
  state: string;
  priority: string;
  updated_at: string;
}

const STATE_ORDER = ['active', 'ready', 'planned', 'inbox', 'waiting', 'blocked', 'done', 'cancelled', 'failed'];

const STATE_COLORS: Record<string, string> = {
  inbox: 'bg-muted/20 text-muted',
  planned: 'bg-accent/10 text-accent',
  ready: 'bg-accent/10 text-accent',
  active: 'bg-success/10 text-success',
  waiting: 'bg-[#f59e0b]/10 text-[#b45309]',
  blocked: 'bg-[#DC2626]/10 text-[#DC2626]',
  done: 'bg-success/10 text-success',
  cancelled: 'bg-muted/10 text-muted/60',
  failed: 'bg-[#DC2626]/10 text-[#DC2626]',
};

const PRIORITY_DOTS: Record<string, string> = {
  critical: 'bg-[#DC2626]',
  high: 'bg-[#f59e0b]',
  normal: 'bg-accent',
  low: 'bg-muted/50',
  none: 'bg-transparent',
};

/** Rank so state sorts by the 11-state-machine order, not alphabetically. */
const stateRank = (state: string) => {
  const i = STATE_ORDER.indexOf(state);
  return i === -1 ? STATE_ORDER.length : i;
};

function relTime(iso: string): string {
  const age = Date.now() - Date.parse(iso);
  const mins = Math.floor(age / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function TasksConsole() {
  const { api, status } = useAuth();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* table state */
  const [sorting, setSorting] = useState<SortingState>([{ id: 'updated_at', desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (status !== 'ready') return;
    let alive = true;
    async function load() {
      try {
        if (!api) throw new Error('The authenticated API bridge is unavailable.');
        const res = await api('/v1/work?limit=50&sort=updated_at&order=desc');
        const data = await res.json();
        if (alive) {
          setItems(data.items ?? []);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(String(err));
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const t = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [api, status]);

  const columns = useMemo<ColumnDef<WorkItem>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all"
            checked={table.getIsAllPageRowsSelected()}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            className="translate-y-[2px]"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label="Select row"
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            className="translate-y-[2px]"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: 'title',
        header: 'Task',
        cell: ({ row }) => (
          <span className="block max-w-[420px] truncate text-[13px] text-ink">
            {row.getValue('title')}
          </span>
        ),
      },
      {
        accessorKey: 'state',
        header: 'State',
        sortingFn: (a, b) => stateRank(a.getValue('state')) - stateRank(b.getValue('state')),
        cell: ({ row }) => {
          const state: string = row.getValue('state');
          return (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide',
                STATE_COLORS[state] ?? 'bg-muted/10 text-muted',
              )}
            >
              {state}
            </span>
          );
        },
      },
      {
        accessorKey: 'priority',
        header: 'Priority',
        cell: ({ row }) => {
          const priority: string = row.getValue('priority');
          return (
            <span className="flex items-center gap-2 text-[12px] text-muted">
              <span className={cn('h-2 w-2 rounded-full', PRIORITY_DOTS[priority] ?? 'bg-transparent')} />
              {priority}
            </span>
          );
        },
      },
      {
        accessorKey: 'updated_at',
        header: ({ column }) => (
          <button
            type="button"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Updated
            <ChevronDown
              className={cn('size-3 transition-transform', column.getIsSorted() === 'asc' && 'rotate-180')}
            />
          </button>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-[10px] text-muted/60">{relTime(row.getValue('updated_at'))}</span>
        ),
        sortingFn: (a, b) => Date.parse(a.getValue('updated_at')) - Date.parse(b.getValue('updated_at')),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
  });

  const selectedCount = table.getFilteredSelectedRowModel().rows.length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8">
        <h1 className="font-display text-xl font-bold text-ink">Tasks</h1>
        <p className="mt-1 text-[12.5px] text-muted">
          Frank&apos;s work board — the 11-state machine. Plane and Google Tasks mirror land here
          once deployed.
        </p>
      </div>

      {/* Engine status cards */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <EngineCard title="Frank DB" status="live" detail={`${items.length} work items`} />
        <EngineCard title="Plane" status="deploying" detail="Self-hosted PM engine" />
        <EngineCard title="Google Tasks" status="planned" detail="Pixel 10 mirror" />
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-[#DC2626]/25 bg-[#FEF2F2] px-4 py-3 text-[12.5px] text-[#DC2626]">
          {error}
        </div>
      )}

      {/* toolbar: filter, column visibility, selection count */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter tasks…"
          value={(table.getColumn('title')?.getFilterValue() as string) ?? ''}
          onChange={(event) => table.getColumn('title')?.setFilterValue(event.target.value)}
          className="max-w-xs h-8 text-[13px]"
          aria-label="Filter tasks by title"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto h-8">
              Columns <ChevronDown className="size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize text-[12.5px]"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {selectedCount > 0 && (
          <Badge variant="secondary" className="h-6">
            {selectedCount} selected
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="space-y-2" aria-label="Loading work items">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
          <p className="text-[13px] text-muted">
            No work items yet. Tell Frank something in Central and it&apos;ll land here.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-white">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className="font-mono text-[10px] uppercase tracking-wide text-muted"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center text-[13px] text-muted">
                    No tasks match the filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function EngineCard({
  title,
  status,
  detail,
}: {
  title: string;
  status: 'live' | 'deploying' | 'planned';
  detail: string;
}) {
  const dot =
    status === 'live' ? 'bg-success' : status === 'deploying' ? 'bg-accent animate-pip' : 'bg-muted/40';
  const label =
    status === 'live' ? 'live' : status === 'deploying' ? 'deploying…' : 'planned';
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <b className="text-[13px] font-semibold text-ink">{title}</b>
      </div>
      <p className="mt-1 text-[11.5px] text-muted">
        {detail} · <span className="font-mono text-[10px] uppercase">{label}</span>
      </p>
    </div>
  );
}
