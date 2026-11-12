// A Base UI tooltip for short labels on icon buttons.
import { Tooltip as Base } from '@base-ui/react/tooltip'
import { cn } from '../../lib/cn'

export const TooltipProvider = Base.Provider
export const Tooltip = Base.Root
export const TooltipTrigger = Base.Trigger

export function TooltipContent({ className, sideOffset = 6, side, ...props }: Base.Popup.Props & Pick<Base.Positioner.Props, 'sideOffset' | 'side'>) {
  return (
    <Base.Portal>
      <Base.Positioner sideOffset={sideOffset} side={side} className="z-50">
        <Base.Popup data-slot="tooltip-content" className={cn('origin-(--transform-origin) rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground transition-[opacity,scale] duration-100 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0', className)} {...props} />
      </Base.Positioner>
    </Base.Portal>
  )
}
