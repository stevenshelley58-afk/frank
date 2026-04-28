import type * as React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/index.js";
import { EmptyState } from "./empty-state.js";
import { cn } from "../../lib/utils.js";

export interface DataTableColumn<TData> {
  id: string;
  header: React.ReactNode;
  cell: (row: TData) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<TData> {
  columns: DataTableColumn<TData>[];
  data: TData[];
  getRowId: (row: TData, index: number) => string;
  emptyState?: React.ReactNode;
  className?: string;
}

export function DataTable<TData>({ columns, data, getRowId, emptyState, className }: DataTableProps<TData>) {
  if (data.length === 0) {
    return (
      <>
        {emptyState ?? <EmptyState title="No data available" description="This view is ready for API-backed rows." />}
      </>
    );
  }

  return (
    <Table className={className}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead key={column.id} className={column.className}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, index) => (
          <TableRow key={getRowId(row, index)} className={cn(index % 2 === 1 && "bg-muted/20")}>
            {columns.map((column) => (
              <TableCell key={column.id} className={column.className}>
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
