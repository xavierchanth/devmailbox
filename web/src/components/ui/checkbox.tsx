// A Base UI checkbox; pass name to submit it with a form.
import { Checkbox as Base } from '@base-ui/react/checkbox'
import { Check } from 'lucide-react'
import { cn } from '../../lib/cn'

export function Checkbox({ className, ...props }: Base.Root.Props) {
  return (
    <Base.Root data-slot="checkbox" className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-card p-0 text-primary-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:border-primary data-checked:bg-primary data-disabled:opacity-50', className)} {...props}>
      <Base.Indicator className="flex data-unchecked:hidden"><Check className="size-3" strokeWidth={3} /></Base.Indicator>
    </Base.Root>
  )
}
