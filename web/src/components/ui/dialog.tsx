// A Base UI modal dialog: a title, a description, content, and a right-aligned footer of actions.
import type { ComponentProps } from 'react'
import { Dialog as Base } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'

export const Dialog = Base.Root
export const DialogTrigger = Base.Trigger
export const DialogClose = Base.Close

export function DialogContent({ className, children, ...props }: Base.Popup.Props) {
  return (
    <Base.Portal>
      <Base.Backdrop className="fixed inset-0 z-50 bg-overlay transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <Base.Popup data-slot="dialog-content" className={cn('fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(520px,calc(100vw-48px))] -translate-1/2 flex-col gap-5 overflow-y-auto rounded-2xl border border-input bg-card p-7 text-card-foreground outline-none transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0', className)} {...props}>
        {children}
        <Base.Close aria-label="Close" className="absolute top-4 right-4 flex size-7 items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></Base.Close>
      </Base.Popup>
    </Base.Portal>
  )
}

export const DialogHeader = ({ className, ...props }: ComponentProps<'div'>) =>
  <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />
export const DialogTitle = ({ className, ...props }: Base.Title.Props) =>
  <Base.Title data-slot="dialog-title" className={cn('m-0 text-lg font-semibold tracking-tight', className)} {...props} />
export const DialogDescription = ({ className, ...props }: Base.Description.Props) =>
  <Base.Description data-slot="dialog-description" className={cn('m-0 text-base text-muted-foreground', className)} {...props} />
export const DialogFooter = ({ className, ...props }: ComponentProps<'div'>) =>
  <div data-slot="dialog-footer" className={cn('flex flex-wrap justify-end gap-2', className)} {...props} />
