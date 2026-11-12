// A hairline between sections.
import { Separator as Base } from '@base-ui/react/separator'
import { cn } from '../../lib/cn'

export const Separator = ({ className, orientation = 'horizontal', ...props }: Base.Props) =>
  <Base data-slot="separator" orientation={orientation} className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)} {...props} />
