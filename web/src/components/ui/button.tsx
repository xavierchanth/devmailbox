// Buttons: outline is the everyday action; default is the one primary action in a form or dialog.
import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-sans font-normal transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: 'border-primary bg-primary text-primary-foreground hover:opacity-90',
        outline: 'border-input bg-card text-foreground hover:not-disabled:border-muted-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:not-disabled:border-border',
        ghost: 'border-transparent bg-transparent text-muted-foreground hover:not-disabled:bg-accent hover:not-disabled:text-accent-foreground',
        destructive: 'border-input bg-card text-destructive hover:not-disabled:border-destructive',
        link: 'h-auto border-transparent bg-transparent p-0 text-muted-foreground hover:text-foreground',
      },
      size: {
        default: 'h-8 px-3 text-sm',
        sm: 'h-7 px-2.5 text-xs',
        lg: 'h-10 px-4 text-base',
        icon: 'size-8 text-sm',
        'icon-sm': 'size-7 text-xs',
      },
    },
    defaultVariants: { variant: 'outline', size: 'default' },
  },
)

export function Button({ className, variant, size, type = 'button', ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button data-slot="button" type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
