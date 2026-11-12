// The Olympus UI kit at #design-system: every token and component in one page, for review.
// Unlinked from the dashboard; the theme picker previews without saving the appearance setting.
import { useState, type ReactNode } from 'react'
import { Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react'
import { applyAppearance, readAppearance, type Appearance } from './lib/appearance'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card'
import { Checkbox } from './components/ui/checkbox'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/menu'
import { Field, FieldDescription, FieldError, Label } from './components/ui/field'
import { Input, Textarea } from './components/ui/input'
import { NativeSelect } from './components/ui/native-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { Separator } from './components/ui/separator'
import { Switch } from './components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Toolbar, ToolbarActions } from './components/ui/toolbar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'

const tokens = [
  ['canvas', 'Page background'], ['surface', 'Panels and controls'], ['subtle', 'Hover, selected, muted fills'],
  ['line', 'Borders and dividers'], ['line-strong', 'Control borders'], ['muted', 'Secondary text'], ['ink', 'Text and primary actions'],
  ['focus', 'Focus ring'], ['danger-text', 'Destructive text'], ['warning-surface', 'Warning fill'], ['warning-text', 'Warning text'],
  ['success-line', 'Healthy borders'], ['info-surface', 'Information fill'],
] as const
const sizes = [['2xl', 'Page title', 'text-2xl font-semibold tracking-tight'], ['lg', 'Dialog title', 'text-lg font-semibold'], ['md', 'Panel title', 'text-md font-medium'], ['base', 'Body and form controls', 'text-base'], ['sm', 'Buttons, tabs, table rows', 'text-sm'], ['xs', 'Notes and metadata', 'text-xs text-muted-foreground'], ['2xs', 'Badges and captions', 'text-2xs text-muted-foreground']] as const
const kinds = [{ value: 'fact', label: 'fact' }, { value: 'decision', label: 'decision' }, { value: 'preference', label: 'preference' }, { value: 'procedure', label: 'procedure' }]

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-border py-10">
      <h2 className="m-0 text-md font-medium">{title}</h2>
      {note && <p className="mt-1.5 mb-0 max-w-2xl text-sm text-muted-foreground">{note}</p>}
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </section>
  )
}
const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[140px_1fr] items-start gap-6 max-sm:grid-cols-1 max-sm:gap-2">
    <span className="pt-2 font-mono text-xs text-muted-foreground">{label}</span>
    <div className="flex flex-wrap items-center gap-3">{children}</div>
  </div>
)

export function DesignSystemPage() {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance)
  const [kind, setKind] = useState('decision')
  const [submitted, setSubmitted] = useState('')
  const preview = (value: Appearance) => { setAppearance(value); applyAppearance(value) }
  const sections = ['Tokens', 'Typography', 'Buttons', 'Badges', 'Forms', 'Selects', 'Cards', 'Toolbar', 'Tabs', 'Overlays']

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background font-sans text-foreground">
        <div className="mx-auto max-w-5xl px-6 pb-24 sm:px-10">
          <div className="flex flex-wrap items-end justify-between gap-6 pt-12 pb-8">
            <div>
              <a href="#" className="text-xl font-semibold tracking-tight">devmailbox<span className="text-muted-foreground">.</span></a>
              <h1 className="mt-6 mb-2 text-2xl font-semibold tracking-tight">Design system</h1>
              <p className="m-0 text-base text-muted-foreground">Tokens and components in web/src/components/ui, built on Base UI in the shadcn/ui pattern.</p>
            </div>
            <Field className="w-44">
              <Label htmlFor="ds-theme" className="text-sm text-muted-foreground">Preview theme</Label>
              <NativeSelect id="ds-theme" size="sm" value={appearance} onChange={e => preview(e.target.value as Appearance)}>
                <option value="auto">System</option><option value="light">Light</option><option value="dark">Dark</option>
              </NativeSelect>
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pb-6 text-sm text-muted-foreground">
            {sections.map(s => <a key={s} href={`#ds-${s.toLowerCase()}`} className="hover:text-foreground">{s}</a>)}
          </div>

          <Section id="ds-tokens" title="Color tokens" note="Pages read these CSS variables from styles/theme.css; components read them through Tailwind names such as bg-card and text-muted-foreground.">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
              {tokens.map(([name, use]) => (
                <div key={name} className="overflow-hidden rounded-lg border border-border bg-card">
                  <div className="h-14 border-b border-border" style={{ background: `var(--${name})` }} />
                  <div className="px-3 py-2.5"><div className="font-mono text-xs">--{name}</div><div className="text-2xs text-muted-foreground">{use}</div></div>
                </div>
              ))}
            </div>
            <Row label="radius">
              {([['sm', 'rounded-sm'], ['md', 'rounded-md'], ['lg', 'rounded-lg'], ['xl', 'rounded-xl'], ['2xl', 'rounded-2xl']] as const).map(([r, className]) => <div key={r} className={`flex size-16 items-center justify-center border border-input bg-card font-mono text-2xs text-muted-foreground ${className}`}>{r}</div>)}
            </Row>
          </Section>

          <Section id="ds-typography" title="Typography" note="A compact scale: 13px body, 12px controls, 11px notes. Geist when installed, then Inter and the system face.">
            {sizes.map(([size, use, className]) => <Row key={size} label={`text-${size}`}><span className={className}>{use}</span></Row>)}
          </Section>

          <Section id="ds-buttons" title="Buttons" note="Outline is the default. Use the filled variant once per form or dialog, for the action that completes it.">
            <Row label="variant">
              <Button variant="default">Save</Button><Button>Edit order</Button><Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button><Button variant="destructive">Delete</Button><Button variant="link">Text link</Button>
            </Row>
            <Row label="size"><Button size="sm">Small</Button><Button>Default</Button><Button size="lg">Large</Button></Row>
            <Row label="icon">
              <Button><Plus />Create area</Button>
              <Tooltip><TooltipTrigger render={<Button size="icon" aria-label="Edit"><Pencil /></Button>} /><TooltipContent>Edit</TooltipContent></Tooltip>
              <Tooltip><TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Delete"><Trash2 /></Button>} /><TooltipContent>Delete</TooltipContent></Tooltip>
            </Row>
            <Row label="state"><Button disabled>Disabled</Button><Button variant="default" disabled>Saving…</Button></Row>
          </Section>

          <Section id="ds-badges" title="Badges">
            <Row label="variant">
              <Badge>v2</Badge><Badge variant="outline">From Executor</Badge><Badge variant="solid">New</Badge>
              <Badge variant="success">Healthy</Badge><Badge variant="warning">Degraded</Badge><Badge variant="destructive">Down</Badge>
            </Row>
          </Section>

          <Section id="ds-forms" title="Form controls" note="Every control is a native element or submits through a hidden input, so forms keep reading values with FormData.">
            <form className="grid max-w-xl gap-5" onSubmit={e => { e.preventDefault(); setSubmitted(JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))) }}>
              <Field><Label htmlFor="ds-title">Title</Label><Input id="ds-title" name="title" defaultValue="Beta promotional TCG giveaway" /></Field>
              <Field><Label htmlFor="ds-body">Memory</Label><Textarea id="ds-body" name="body" rows={4} placeholder="What should agents remember?" /><FieldDescription>Leave blank to derive a short excerpt.</FieldDescription></Field>
              <Field><Label htmlFor="ds-url">URL</Label><Input id="ds-url" name="url" aria-invalid defaultValue="not a url" /><FieldError>Enter a full URL, including https://.</FieldError></Field>
              <Field><Label htmlFor="ds-disabled">Disabled</Label><Input id="ds-disabled" disabled defaultValue="Read only" /></Field>
              <Label><Checkbox name="inBriefing" defaultChecked />Include in briefing when current</Label>
              <Label><Switch name="autoApps" defaultChecked />Automatic apps</Label>
              <div className="flex gap-2"><Button variant="default" type="submit">Submit</Button></div>
              {submitted && <pre className="m-0 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{submitted}</pre>}
            </form>
          </Section>

          <Section id="ds-selects" title="Selects" note="NativeSelect is the default: it submits with forms and works inside native <dialog>s. Select is the Base UI listbox for pages where a styled popup matters.">
            <div className="grid max-w-xl gap-5">
              <Field><Label htmlFor="ds-kind">Kind (NativeSelect)</Label>
                <NativeSelect id="ds-kind" defaultValue="decision">{kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</NativeSelect>
              </Field>
              <Field><Label htmlFor="ds-kind-sm">Small</Label>
                <NativeSelect id="ds-kind-sm" size="sm" className="w-48" defaultValue="all"><option value="all">All areas</option><option value="xc">xc</option><option value="cc">cc</option></NativeSelect>
              </Field>
              <Field><Label htmlFor="ds-multi">Multiple</Label>
                <NativeSelect id="ds-multi" multiple className="h-24">{kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</NativeSelect>
              </Field>
              <Field><Label>Kind (Select)</Label>
                <Select items={kinds} value={kind} onValueChange={value => value && setKind(value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{kinds.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
          </Section>

          <Section id="ds-cards" title="Cards">
            <div className="grid gap-5 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Today</CardTitle><CardDescription>Combined calendars</CardDescription><CardAction><Button size="sm">Open</Button></CardAction></CardHeader>
                <CardContent className="flex flex-col">
                  {['Standup', 'Design review', 'Ship Olympus UI kit'].map(t => <div key={t} className="flex items-center justify-between border-b border-border py-3 text-sm last:border-0">{t}<Badge variant="outline">10:00</Badge></div>)}
                </CardContent>
                <CardFooter>Checked every minute</CardFooter>
              </Card>
              <Card className="flex flex-col items-center justify-center px-8 py-12 text-center">
                <h3 className="m-0 text-md font-medium">No apps yet</h3>
                <p className="mt-2.5 mb-4 max-w-xs text-sm text-muted-foreground">Register an app or connect Executor to discover the accounts you use.</p>
                <Button size="sm"><Plus />Register app</Button>
              </Card>
            </div>
          </Section>

          <Section id="ds-toolbar" title="Toolbar" note="A note on the left and actions grouped on the right, for the top of settings lists.">
            <Card className="px-6">
              <Toolbar>
                <p className="m-0 text-xs text-muted-foreground">Create areas once, then choose where each is used.</p>
                <ToolbarActions><Button>Edit order</Button><Button><Plus />Create area</Button></ToolbarActions>
              </Toolbar>
              <Separator />
              {['xc', 'cc/ara', 'al'].map(a => (
                <div key={a} className="flex items-center justify-between gap-3 border-b border-border py-4 last:border-0">
                  <div><div className="text-base">{a}</div><div className="text-xs text-muted-foreground">Instructions: on · Apps: on</div></div>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Actions for ${a}`}><Ellipsis /></Button>} />
                    <DropdownMenuContent><DropdownMenuItem><Pencil />Edit</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive"><Trash2 />Delete</DropdownMenuItem></DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </Card>
          </Section>

          <Section id="ds-tabs" title="Tabs">
            <Tabs defaultValue="all">
              <TabsList><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="production">Production</TabsTrigger><TabsTrigger value="staging">Staging</TabsTrigger><TabsTrigger value="lab" disabled>Lab</TabsTrigger></TabsList>
              <TabsContent value="all" className="text-sm text-muted-foreground">Every check across environments.</TabsContent>
              <TabsContent value="production" className="text-sm text-muted-foreground">Checked every minute.</TabsContent>
              <TabsContent value="staging" className="text-sm text-muted-foreground">Checked every 15 minutes.</TabsContent>
            </Tabs>
          </Section>

          <Section id="ds-overlays" title="Dialog, menu and tooltip">
            <Row label="dialog">
              <Dialog>
                <DialogTrigger render={<Button>Edit memory</Button>} />
                <DialogContent>
                  <DialogHeader><DialogTitle>Edit memory</DialogTitle><DialogDescription>Changes apply to the next briefing.</DialogDescription></DialogHeader>
                  <Field><Label htmlFor="ds-dialog-title">Title</Label><Input id="ds-dialog-title" defaultValue="Beta promotional TCG giveaway" /></Field>
                  <Field><Label htmlFor="ds-dialog-kind">Kind</Label><NativeSelect id="ds-dialog-kind" defaultValue="decision">{kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</NativeSelect></Field>
                  <DialogFooter><DialogClose render={<Button>Cancel</Button>} /><DialogClose render={<Button variant="default">Save</Button>} /></DialogFooter>
                </DialogContent>
              </Dialog>
            </Row>
            <Row label="menu">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button>Actions<Ellipsis /></Button>} />
                <DropdownMenuContent align="start"><DropdownMenuItem>Retire</DropdownMenuItem><DropdownMenuItem>Supersede</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive">Purge</DropdownMenuItem></DropdownMenuContent>
              </DropdownMenu>
            </Row>
            <Row label="tooltip">
              <Tooltip><TooltipTrigger render={<Button variant="ghost">Hover me</Button>} /><TooltipContent>Short label</TooltipContent></Tooltip>
            </Row>
          </Section>
        </div>
      </div>
    </TooltipProvider>
  )
}
