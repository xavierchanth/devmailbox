// Mailboxes: one per API key or SMTP username. Picking one filters the inbox (mailbox:<name>).

import { Ellipsis, Inbox, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, type Mailbox } from "./api.ts";
import { Button } from "./components/ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/ui/menu.tsx";
import { cn } from "./lib/cn.ts";

export function Sidebar({
  mailboxes,
  active,
  onSelect,
  onCleared,
}: {
  mailboxes: Mailbox[];
  active: string | null;
  onSelect: (name: string | null) => void;
  onCleared: () => void;
}) {
  const [clearing, setClearing] = useState<Mailbox | null>(null);
  const total = mailboxes.reduce((n, m) => n + m.messages, 0);
  return (
    <nav aria-label="Mailboxes" className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border py-3 max-md:hidden">
      <Item label="All mail" count={total} active={active === null} onClick={() => onSelect(null)} icon />
      <div className="mt-4 mb-1 px-5 text-2xs font-medium tracking-wide text-muted-foreground uppercase">Mailboxes</div>
      {mailboxes.length === 0 && <p className="m-0 px-5 text-xs text-muted-foreground">None yet. They appear with their first message.</p>}
      {mailboxes.map((m) => (
        <Item
          key={m.name}
          label={m.name}
          count={m.messages}
          active={active === m.name}
          onClick={() => onSelect(m.name)}
          menu={
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.name}`} className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100">
                    <Ellipsis />
                  </Button>
                }
              />
              <DropdownMenuContent>
                <DropdownMenuItem variant="destructive" onClick={() => setClearing(m)}>
                  <Trash2 />
                  Clear mailbox
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      ))}
      <Dialog open={!!clearing} onOpenChange={(open) => !open && setClearing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear {clearing?.name}?</DialogTitle>
            <DialogDescription>
              This deletes its {clearing?.messages} message{clearing?.messages === 1 ? "" : "s"}. Other people and agents
              may be reading this mailbox. It comes back when new mail arrives.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button>Cancel</Button>} />
            <Button
              variant="destructive"
              onClick={() => {
                const name = clearing!.name;
                setClearing(null);
                void api.deleteMailbox(name).then(() => {
                  if (active === name) onSelect(null);
                  onCleared();
                });
              }}
            >
              Clear mailbox
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

function Item({
  label,
  count,
  active,
  onClick,
  icon,
  menu,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon?: boolean;
  menu?: React.ReactNode;
}) {
  return (
    <div className={cn("group mx-2 flex items-center gap-1 rounded-md pr-1 hover:bg-accent", active && "bg-accent")}>
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={onClick}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent py-1.5 pl-3 text-left text-sm outline-none focus-visible:outline-2 focus-visible:outline-ring",
          active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {icon && <Inbox className="size-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
        <span className="ml-auto pl-2 text-xs text-muted-foreground tabular-nums">{count}</span>
      </button>
      {/* rows without a menu keep its space, so counts line up */}
      {menu ?? <span aria-hidden className="size-6 shrink-0" />}
    </div>
  );
}
