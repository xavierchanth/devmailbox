// A row with a note or title on the left and grouped actions on the right.
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'

export const Toolbar = ({ className, ...props }: ComponentProps<'div'>) =>
  <div data-slot="toolbar" className={cn('flex flex-wrap items-center gap-3 py-5', className)} {...props} />
export const ToolbarActions = ({ className, ...props }: ComponentProps<'div'>) =>
  <div data-slot="toolbar-actions" className={cn('ml-auto flex flex-wrap items-center gap-2', className)} {...props} />
