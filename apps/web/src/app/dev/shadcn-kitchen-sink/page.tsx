'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

/**
 * shadcn bridge kitchen sink (Track A1 verification page).
 *
 * Renders every vendored primitive twice — once under the light theme
 * (inherited from <html data-frank-theme="light">) and once under an
 * explicit data-frank-theme="dark" wrapper, proving the token bridge
 * drives both themes from frank-tokens alone.
 */

function Suite({ tone }: { tone: 'light' | 'dark' }) {
  return (
    <div
      data-frank-theme={tone}
      className="rounded-lg border border-line bg-background p-6"
      style={{ background: 'rgb(var(--background))', color: 'rgb(var(--foreground))' }}
    >
      <div className="ds-label mb-4 text-muted-foreground">theme: {tone}</div>

      <div className="flex flex-wrap items-center gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
        <Button disabled>Disabled</Button>
      </div>

      <div className="mt-5 grid max-w-md grid-cols-1 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`in-${tone}`}>Input label</Label>
          <Input id={`in-${tone}`} placeholder="Type here…" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`ta-${tone}`}>Textarea</Label>
          <Textarea id={`ta-${tone}`} rows={2} placeholder="Notes" />
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox id={`cb-${tone}`} /> Checkbox
          </label>
          <div className="flex items-center gap-2 text-sm">
            <Switch id={`sw-${tone}`} />
            <Label htmlFor={`sw-${tone}`}>Switch</Label>
          </div>
          <Badge>badge</Badge>
          <Badge variant="outline">outline</Badge>
          <Badge variant="secondary">secondary</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Select a room" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="central">Central</SelectItem>
              <SelectItem value="builder">Builder</SelectItem>
              <SelectItem value="research">Research</SelectItem>
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Popover</Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 text-sm">
              Popover content follows the theme automatically.
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-44">
              <DropdownMenuItem>Duplicate</DropdownMenuItem>
              <DropdownMenuItem>Rename</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost">Tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>Focus ring uses Frank signal.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Approve deploy</DialogTitle>
              <DialogDescription>
                Dialog overlay — focus trap, escape handling and scroll lock come free with
                the vendored Radix primitive.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline">Cancel</Button>
              <Button>Approve</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open sheet</Button>
          </SheetTrigger>
          <SheetContent className="w-80">
            <SheetHeader>
              <SheetTitle>Peek card</SheetTitle>
              <SheetDescription>
                Sheet slides in from the right — the pattern A4 uses for peek-card.
              </SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
        <Button variant="outline" onClick={() => toast('Deploy queued', { description: 'sonner toast via the token bridge.' })}>
          Fire toast
        </Button>
      </div>

      <div className="mt-5 grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Card</CardTitle>
            <CardDescription>Card surfaces map to Frank paper tokens.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="runs">
              <TabsList>
                <TabsTrigger value="runs">Runs</TabsTrigger>
                <TabsTrigger value="files">Files</TabsTrigger>
              </TabsList>
              <TabsContent value="runs">Run history lives here.</TabsContent>
              <TabsContent value="files">File list lives here.</TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <div className="space-y-3">
          <div className="flex items-center space-x-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-[250px]" />
              <Skeleton className="h-4 w-[200px]" />
            </div>
          </div>
          <Separator />
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Builder</TableCell>
                  <TableCell>
                    <Badge variant="secondary">active</Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Research</TableCell>
                  <TableCell>
                    <Badge variant="outline">waiting</Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ShadcnKitchenSinkPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-lg font-semibold">shadcn/ui × Frank — token bridge kitchen sink</h1>
        <p className="text-sm text-muted-foreground">
          Track A1 verification: every vendored primitive rendered in both Atlantic themes.
          Focus rings are signal-colored; dark surfaces read shell/rail/card from frank-tokens.
        </p>
      </header>
      <Suite tone="light" />
      <Suite tone="dark" />
      <Toaster />
    </main>
  );
}
