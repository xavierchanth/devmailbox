// Small status and metadata labels.
import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

export const badgeVariants = cva('inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-2xs [&_svg]:size-3', {
  variants: {
    variant: {
      default: 'border-border bg-muted text-muted-foreground',
      outline: 'border-border bg-transparent text-muted-foreground',
      solid: 'border-primary bg-primary text-primary-foreground',
      success: 'border-success bg-transparent text-foreground',
      warning: 'border-warning-border bg-warning text-warning-foreground',
      destructive: 'border-destructive/40 bg-transparent text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
})

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}
