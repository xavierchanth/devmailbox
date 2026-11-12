// Panels: a bordered surface with an optional header, content and footer.
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export const Card = ({ className, ...props }: ComponentProps<'div'>) =>
  <div data-slot="card" className={cn('overflow-hidden rounded-xl border border-border bg-card text-card-foreground', className)} {...props} />
export const CardHeader = ({ className, ...props }: ComponentProps<'div'>) =>
  <div data-slot="card-header" className={cn('grid auto-rows-min grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-6 py-5', className)} {...props} />
export const CardTitle = ({ className, ...props }: ComponentProps<'h2'>) =>
  <h2 data-slot="card-title" className={cn('m-0 text-md font-medium', className)} {...props} />
export const CardDescription = ({ className, ...props }: ComponentProps<'p'>) =>
  <p data-slot="card-description" className={cn('col-start-1 m-0 text-xs text-muted-foreground', className)} {...props} />
export const CardAction = ({ className, ...props }: ComponentProps<'div'>) =>
  <div data-slot="card-action" className={cn('col-start-2 row-span-2 row-start-1 flex items-center gap-2 self-center', className)} {...props} />
export const CardContent = ({ className, ...props }: ComponentProps<'div'>) =>
  <div data-slot="card-content" className={cn('px-6 pb-5', className)} {...props} />
export const CardFooter = ({ className, ...props }: ComponentProps<'div'>) =>
  <div data-slot="card-footer" className={cn('flex items-center gap-3 border-t border-border px-6 py-3.5 text-xs text-muted-foreground', className)} {...props} />
