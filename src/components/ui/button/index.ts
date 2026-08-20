import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Button } from "./Button.vue"

/** Focus chrome via inset shadow so focus never changes box size. */
const navFocusClasses =
  "focus-visible:border-transparent focus-visible:ring-0 focus-visible:shadow-[inset_2px_0_0_0_var(--primary)] focus-visible:text-sidebar-foreground"

/** Shared geometry for nav / nav-active — must stay identical to avoid rail shift. */
const navGeometry =
  "h-10! w-full rounded-none border-0 shadow-none active:translate-y-0"

const tabIndicatorClasses =
  "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-20 after:h-0.5 after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-150 after:ease-out after:content-['']"

const tabBaseClasses = `relative h-12! min-h-12! overflow-hidden rounded-none px-5! text-xs! font-normal! uppercase tracking-wide transition-colors bg-transparent! shadow-none hover:bg-transparent! items-center! justify-center! active:translate-y-0 ${tabIndicatorClasses}`

export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground aria-pressed:bg-secondary aria-pressed:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
        nav: `${navGeometry} bg-transparent font-medium text-muted-foreground/70 transition-[color,box-shadow] duration-100 nav-border-inactive hover:nav-border-hover hover:text-sidebar-foreground ${navFocusClasses}`,
        "nav-active": `${navGeometry} bg-transparent font-medium text-foreground transition-[color,box-shadow] duration-100 nav-border-active ${navFocusClasses}`,
        headerAction:
          "p-0! inline-flex items-center justify-center text-muted-foreground/80 transition-all duration-100 rounded-sm border border-transparent border-dashed hover:border-border/50 hover:bg-sidebar/50 hover:text-foreground active:bg-sidebar active:text-primary-foreground active:border-border active:border-solid active:duration-150 data-[state=open]:bg-sidebar data-[state=open]:border-primary data-[state=open]:border-dashed data-[state=open]:text-foreground focus-visible:border-solid disabled:!opacity-50",
        "sidebar-action":
          "inline-flex items-center justify-center bg-background/80 text-muted-foreground/80 transition-all duration-150 rounded-sm border border-transparent border-dashed hover:border-border hover:bg-background hover:text-foreground active:bg-sidebar active:text-primary-foreground active:border-border active:border-solid active:duration-150 data-[state=open]:bg-sidebar data-[state=open]:border-primary data-[state=open]:border-dashed data-[state=open]:text-foreground focus-visible:border-solid disabled:!opacity-50 focus-visible:ring-0 focus-visible:ring-border/50 focus-visible:ring-[2px]",
        "card-action-primary":
          "h-9! border rounded-sm border-transparent bg-input text-foreground/80 shadow-none transition duration-100 ease-out hover:border-primary/70 hover:bg-primary/40 hover:text-foreground active:scale-95 disabled:cursor-wait disabled:opacity-60",
        "color-swatch":
          "border border-border/50 bg-transparent p-0 shadow-none hover:bg-transparent hover:brightness-110 hover:text-inherit rounded-sm!",
        tab: `${tabBaseClasses} text-muted-foreground hover:text-foreground`,
        "tab-active": `${tabBaseClasses} text-foreground after:scale-x-100`,
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-8.5 gap-1 px-3 has-[>svg]:px-2 text-sm",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // Keep horizontal padding on variant `tab` / `tab-active` (`px-5!`).
        // `p-0!` here was winning in twMerge and collapsing tab labels together.
        tab: "h-12! min-h-12! gap-0! py-0!",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)]",
        "icon-lg": "size-9",
        "icon-header": "h-7! w-10! shrink-0 [&_[class*='size-']]:size-3.5!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)
export type ButtonVariants = VariantProps<typeof buttonVariants>
