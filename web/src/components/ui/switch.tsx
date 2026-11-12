// A Base UI switch for settings that apply immediately.
import { Switch as Base } from '@base-ui/react/switch'
import { cn } from '../../lib/cn'

export function Switch({ className, ...props }: Base.Root.Props) {
  return (
    <Base.Root data-slot="switch" className={cn('inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-input p-0.5 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:bg-primary data-disabled:opacity-50', className)} {...props}>
      <Base.Thumb className="block size-4 rounded-full bg-card shadow-sm transition-transform data-checked:translate-x-4" />
    </Base.Root>
  )
}
