// A Base UI dropdown menu for row and page actions.
import { Menu as Base } from '@base-ui/react/menu'
import { cn } from '../../lib/cn'

export const popupClass = 'origin-(--transform-origin) rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[0_8px_24px_#0000001f] outline-none transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0'

export const DropdownMenu = Base.Root
export const DropdownMenuTrigger = Base.Trigger
export const DropdownMenuGroup = Base.Group

export function DropdownMenuContent({ className, sideOffset = 4, align = 'end', ...props }: Base.Popup.Props & Pick<Base.Positioner.Props, 'sideOffset' | 'align' | 'side'>) {
  return (
    <Base.Portal>
      <Base.Positioner sideOffset={sideOffset} align={align} className="z-50 outline-none">
        <Base.Popup data-slot="dropdown-menu-content" className={cn(popupClass, 'min-w-40', className)} {...props} />
      </Base.Positioner>
    </Base.Portal>
  )
}

export const DropdownMenuItem = ({ className, variant, ...props }: Base.Item.Props & { variant?: 'default' | 'destructive' }) =>
  <Base.Item data-slot="dropdown-menu-item" className={cn('flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-base outline-none select-none data-disabled:opacity-50 data-highlighted:bg-accent [&_svg]:size-3.5 [&_svg]:text-muted-foreground', variant === 'destructive' && 'text-destructive [&_svg]:text-destructive', className)} {...props} />
export const DropdownMenuLabel = ({ className, ...props }: Base.GroupLabel.Props) =>
  <Base.GroupLabel data-slot="dropdown-menu-label" className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)} {...props} />
export const DropdownMenuSeparator = ({ className, ...props }: Base.Separator.Props) =>
  <Base.Separator data-slot="dropdown-menu-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
