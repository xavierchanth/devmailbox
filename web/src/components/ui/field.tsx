// Form layout: a label, its control, and optional help or error text, stacked.
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export const Label = ({ className, ...props }: ComponentProps<'label'>) =>
  <label data-slot="label" className={cn('flex items-center gap-2 text-base text-foreground select-none has-disabled:opacity-50', className)} {...props} />
export const Field = ({ className, ...props }: ComponentProps<'div'>) =>
  <div data-slot="field" className={cn('flex flex-col gap-2', className)} {...props} />
export const FieldDescription = ({ className, ...props }: ComponentProps<'p'>) =>
  <p data-slot="field-description" className={cn('m-0 text-xs text-muted-foreground', className)} {...props} />
export const FieldError = ({ className, ...props }: ComponentProps<'p'>) =>
  <p data-slot="field-error" role="alert" className={cn('m-0 text-xs text-destructive empty:hidden', className)} {...props} />
