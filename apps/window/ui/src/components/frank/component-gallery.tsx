import * as React from "react"
import {
  Check,
  ChevronDown,
  Copy,
  Info,
  Mail,
  MoreHorizontal,
  Plus,
  Star,
  Trash2,
  TriangleAlert,
} from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base font-semibold tracking-tight">{title}</h2>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}

export function ComponentGallery() {
  const [checked, setChecked] = React.useState(true)
  const [switched, setSwitched] = React.useState(true)

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          Frank design system
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Every component below is the real shadcn/ui source installed with the CLI — Radix
          primitives, Tailwind v4, OKLCH tokens. shadcn is the default for all new Frank UI.
          Toggle dark mode to check both themes.
        </p>
      </header>

      <Section title="Buttons" note="Six variants × four sizes, plus icon and disabled states.">
        <Row>
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row>
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Add"><Plus /></Button>
          <Button variant="outline" size="icon" aria-label="More"><MoreHorizontal /></Button>
        </Row>
      </Section>

      <Section
        title="Badges & status"
        note="Frank never signals status by colour alone — icon plus word."
      >
        <Row>
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline" className="border-transparent bg-emerald-50 text-emerald-800">
            <Check className="size-3" /> Ready
          </Badge>
          <Badge variant="outline" className="border-transparent bg-amber-50 text-amber-900">
            <TriangleAlert className="size-3" /> Degraded
          </Badge>
          <Badge variant="outline" className="border-transparent bg-red-50 text-red-800">
            Unavailable
          </Badge>
          <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">
            Empty
          </Badge>
        </Row>
      </Section>

      <Section title="Cards" note="The container for every panel and source tile.">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>Supporting description text.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Content area.</p>
            </CardContent>
            <CardFooter>
              <Button size="sm" variant="outline">Action</Button>
            </CardFooter>
          </Card>
          <Card className="border-l-[3px] border-l-violet-600">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Domain rule</CardTitle>
              <CardDescription>
                A 3px left border in the domain colour makes a grid scannable.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">4</p>
            </CardContent>
          </Card>
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Empty state</CardTitle>
              <CardDescription>Designed, not a dimmed grey box.</CardDescription>
            </CardHeader>
            <CardContent>
              <Empty className="border-0 p-0">
                <EmptyHeader>
                  <EmptyTitle>Nothing here yet</EmptyTitle>
                  <EmptyDescription>Connect a source to populate this panel.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        title="Forms"
        note="93 buttons, 54 inputs, 27 selects and 11 textareas exist in Frank today."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="g-name">Display name</Label>
              <Input id="g-name" placeholder="Blockwise" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="g-src">Source</Label>
              <Select defaultValue="crm">
                <SelectTrigger id="g-src">
                  <SelectValue placeholder="Select a source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mail">Mail</SelectItem>
                  <SelectItem value="crm">CRM</SelectItem>
                  <SelectItem value="support">Support</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="g-note">Note</Label>
              <Textarea id="g-note" placeholder="Leave a note for the owner" />
            </div>
          </div>
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <Checkbox
                id="g-check"
                checked={checked}
                onCheckedChange={(v) => setChecked(Boolean(v))}
              />
              <Label htmlFor="g-check">Include archived records</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="g-switch" checked={switched} onCheckedChange={setSwitched} />
              <Label htmlFor="g-switch">Auto-refresh every 5 minutes</Label>
            </div>
            <RadioGroup defaultValue="all" className="gap-3">
              <div className="flex items-center gap-3">
                <RadioGroupItem value="all" id="g-r1" />
                <Label htmlFor="g-r1">All observations</Label>
              </div>
              <div className="flex items-center gap-3">
                <RadioGroupItem value="changed" id="g-r2" />
                <Label htmlFor="g-r2">Changed only</Label>
              </div>
            </RadioGroup>
            <div className="flex flex-col gap-3">
              <Label>Coverage threshold</Label>
              <Slider defaultValue={[40]} max={100} step={5} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Data table" note="Frank renders data with divs today; tables should be tables.">
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Δ 7d</TableHead>
                <TableHead>State</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { s: "Mail", o: "Steven", n: 3, d: -25, st: "Degraded" },
                { s: "CRM", o: "Steven", n: 4, d: 12, st: "Ready" },
                { s: "Support", o: "—", n: 0, d: 0, st: "Empty" },
                { s: "Campaigns", o: "Hermes", n: 2, d: 8, st: "Ready" },
              ].map((r) => (
                <TableRow key={r.s}>
                  <TableCell className="font-medium">{r.s}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="size-6">
                        <AvatarFallback className="text-[10px]">
                          {r.o === "—" ? "?" : r.o.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      {r.o}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.n}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      r.d > 0 ? "text-emerald-700" : r.d < 0 ? "text-red-700" : "text-muted-foreground"
                    }`}
                  >
                    {r.d > 0 ? "+" : ""}
                    {r.d}%
                  </TableCell>
                  <TableCell><Badge variant="outline">{r.st}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section title="Feedback & loading">
        <div className="grid gap-4 md:grid-cols-2">
          <Alert>
            <Info />
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>
              Mautic did not answer the last check. The source stays listed so you can see what
              is missing.
            </AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Source unavailable</AlertTitle>
            <AlertDescription>The CRM adapter is not installed in this release.</AlertDescription>
          </Alert>
          <div className="flex flex-col gap-3">
            <Label>Import progress</Label>
            <Progress value={64} />
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </Section>

      <Section title="Navigation">
        <Row>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem><BreadcrumbLink href="#">Blockwise</BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbLink href="#">Sources</BreadcrumbLink></BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>Mail</BreadcrumbPage></BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </Row>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="control">Control</TabsTrigger>
          </TabsList>
          {["overview", "library", "runs", "control"].map((v) => (
            <TabsContent key={v} value={v} className="pt-4 text-sm text-muted-foreground">
              {v[0].toUpperCase() + v.slice(1)} panel content.
            </TabsContent>
          ))}
        </Tabs>
        <Pagination className="justify-start">
          <PaginationContent>
            <PaginationItem><PaginationPrevious href="#" /></PaginationItem>
            <PaginationItem><PaginationLink href="#">1</PaginationLink></PaginationItem>
            <PaginationItem><PaginationLink href="#" isActive>2</PaginationLink></PaginationItem>
            <PaginationItem><PaginationLink href="#">3</PaginationLink></PaginationItem>
            <PaginationItem><PaginationEllipsis /></PaginationItem>
            <PaginationItem><PaginationNext href="#" /></PaginationItem>
          </PaginationContent>
        </Pagination>
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="a">
            <AccordionTrigger>Why is this source unavailable?</AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              The adapter is not installed in this release, so Frank shows nothing rather than a
              zero.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <Collapsible className="w-full">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm"><ChevronDown /> Technical detail</Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 font-mono text-xs text-muted-foreground">
            reason: adapter_missing · declared interface: /api/owner/workspace/sources/crm
          </CollapsibleContent>
        </Collapsible>
      </Section>

      <Section title="Overlays" note="4 modals and 3 disclosure elements exist in Frank today.">
        <Row>
          <Dialog>
            <DialogTrigger asChild><Button variant="outline">Open dialog</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign an owner</DialogTitle>
                <DialogDescription>
                  This opens the record in the native CRM, which stays authoritative.
                </DialogDescription>
              </DialogHeader>
              <Input placeholder="Search people" />
              <DialogFooter>
                <Button variant="outline">Cancel</Button>
                <Button>Assign</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Destructive confirm</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Quarantine this creative?</AlertDialogTitle>
                <AlertDialogDescription>
                  It stays in the archive but is excluded from the next release.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction>Quarantine</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">Menu <ChevronDown /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Row actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem><Copy /> Duplicate</DropdownMenuItem>
              <DropdownMenuItem><Star /> Star</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive"><Trash2 /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover>
            <PopoverTrigger asChild><Button variant="outline">Popover</Button></PopoverTrigger>
            <PopoverContent className="w-64 text-sm">
              Filters and saved views live here.
            </PopoverContent>
          </Popover>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Info"><Info /></Button>
            </TooltipTrigger>
            <TooltipContent>Last successful check: 5:12 AM</TooltipContent>
          </Tooltip>

          <HoverCard>
            <HoverCardTrigger asChild><Button variant="link">Hover card</Button></HoverCardTrigger>
            <HoverCardContent className="w-72 text-sm">
              <p className="font-medium">Riverside</p>
              <p className="text-muted-foreground">Enquiry inbound 2 hours ago, no owner.</p>
            </HoverCardContent>
          </HoverCard>
        </Row>
      </Section>

      <Section title="Command palette" note="For cross-source search — Cmd-K.">
        <Card className="max-w-md py-0">
          <Command>
            <CommandInput placeholder="Search sources, records, runs…" />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup heading="Sources">
                <CommandItem><Mail /> Mail</CommandItem>
                <CommandItem><Star /> CRM</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </Card>
      </Section>

      <Section title="Scroll area" note="Long lists and comparison panes.">
        <Card className="max-w-md py-0">
          <ScrollArea className="h-56">
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>Observation {i + 1}</span>
                  <Badge variant="outline">new</Badge>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>
        <Row>
          <Toggle aria-label="Star"><Star /></Toggle>
          <Separator orientation="vertical" className="h-8" />
          <span className="text-sm text-muted-foreground">Toggle + separator</span>
        </Row>
      </Section>
    </div>
  )
}
