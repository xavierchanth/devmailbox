// Base UI tabs with the Olympus underline style.
import { Tabs as Base } from '@base-ui/react/tabs'
import { cn } from '../../lib/cn'

export const Tabs = ({ className, ...props }: Base.Root.Props) =>
  <Base.Root data-slot="tabs" className={cn('flex flex-col', className)} {...props} />
export const TabsList = ({ className, children, ...props }: Base.List.Props) => (
  <Base.List data-slot="tabs-list" className={cn('relative flex gap-6 overflow-x-auto border-b border-border', className)} {...props}>
    {children}
    <Base.Indicator className="absolute bottom-0 left-(--active-tab-left) h-0.5 w-(--active-tab-width) bg-foreground transition-all duration-150" />
  </Base.List>
)
export const TabsTrigger = ({ className, ...props }: Base.Tab.Props) =>
  <Base.Tab data-slot="tabs-trigger" className={cn('border-0 bg-transparent px-0 py-4 text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-active:text-foreground data-disabled:opacity-50', className)} {...props} />
export const TabsContent = ({ className, ...props }: Base.Panel.Props) =>
  <Base.Panel data-slot="tabs-content" className={cn('pt-5 outline-none', className)} {...props} />
