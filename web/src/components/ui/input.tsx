// Text inputs and text areas share the form control look.
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export const controlClass = 'w-full min-w-0 rounded-md border border-input bg-card px-3 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive'

export const Input = ({ className, type, ...props }: ComponentProps<'input'>) =>
  <input data-slot="input" type={type} className={cn(controlClass, 'h-10', className)} {...props} />

export const Textarea = ({ className, ...props }: ComponentProps<'textarea'>) =>
  <textarea data-slot="textarea" className={cn(controlClass, 'min-h-20 resize-y py-2.5 leading-relaxed', className)} {...props} />
