// A Base UI select with a styled popup. Its popup is portaled, so use NativeSelect inside native <dialog>s.
import type { ComponentProps } from 'react'
import { Select as Base } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'
import { popupClass } from './menu'

export const Select = Base.Root
export const SelectGroup = Base.Group
export const SelectValue = ({ className, ...props }: Base.Value.Props) =>
  <Base.Value data-slot="select-value" className={cn('truncate data-placeholder:text-muted-foreground', className)} {...props} />

export function SelectTrigger({ className, size = 'default', children, ...props }: Base.Trigger.Props & { size?: 'sm' | 'default' }) {
  return (
    <Base.Trigger data-slot="select-trigger" className={cn('flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-card pr-3 pl-3 text-left text-base text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-disabled:opacity-50 data-popup-open:border-muted-foreground', size === 'sm' ? 'h-8 pl-2.5 text-sm' : 'h-10', className)} {...props}>
      {children}
      <Base.Icon className="flex text-muted-foreground"><ChevronDown className="size-4" /></Base.Icon>
    </Base.Trigger>
  )
}

export function SelectContent({ className, children, sideOffset = 4, alignItemWithTrigger = false, ...props }: Base.Popup.Props & Pick<Base.Positioner.Props, 'sideOffset' | 'align' | 'alignItemWithTrigger'>) {
  return (
    <Base.Portal>
      <Base.Positioner sideOffset={sideOffset} alignItemWithTrigger={alignItemWithTrigger} className="z-50 outline-none">
        <Base.Popup data-slot="select-content" className={cn(popupClass, 'min-w-(--anchor-width) max-h-(--available-height) overflow-y-auto', className)} {...props}>
          <Base.List>{children}</Base.List>
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  )
}

export function SelectItem({ className, children, ...props }: Base.Item.Props) {
  return (
    <Base.Item data-slot="select-item" className={cn('relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-base outline-none select-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground', className)} {...props}>
      <Base.ItemText>{children}</Base.ItemText>
      <Base.ItemIndicator className="absolute right-2 flex"><Check className="size-3.5" /></Base.ItemIndicator>
    </Base.Item>
  )
}

export const SelectLabel = ({ className, ...props }: Base.GroupLabel.Props) =>
  <Base.GroupLabel data-slot="select-label" className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)} {...props} />
export const SelectSeparator = ({ className, ...props }: ComponentProps<typeof Base.Separator>) =>
  <Base.Separator data-slot="select-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
