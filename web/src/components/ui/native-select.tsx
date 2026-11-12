// A styled native select: works with forms and FormData and inside native <dialog>s.
import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'
import { controlClass } from './input'

export function NativeSelect({ className, size = 'default', multiple, ...props }: Omit<ComponentProps<'select'>, 'size'> & { size?: 'sm' | 'default' }) {
  if (multiple) return <select data-slot="native-select" multiple className={cn(controlClass, 'py-1.5', className)} {...props} />
  return (
    <span data-slot="native-select-wrapper" className={cn('relative inline-flex w-full min-w-0 text-foreground', className)}>
      <select data-slot="native-select" className={cn(controlClass, 'appearance-none pr-9', size === 'sm' ? 'h-8 pl-2.5 text-sm' : 'h-10')} {...props} />
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  )
}
