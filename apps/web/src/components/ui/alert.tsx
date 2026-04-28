import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

export const alertVariants = cva("relative w-full rounded-lg border px-4 py-3 text-sm leading-6", {
  variants: {
    variant: {
      default: "border-border bg-card text-card-foreground",
      success: "border-success/30 bg-success/10 text-foreground",
      warning: "border-warning/30 bg-warning/10 text-foreground",
      destructive: "border-destructive/30 bg-destructive/10 text-foreground"
    }
  },
  defaultVariants: {
    variant: "default"
  }
});

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h5 ref={ref} className={cn("mb-1 font-semibold leading-5", className)} {...props} />
);
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm leading-6 text-muted-foreground", className)} {...props} />
  )
);
AlertDescription.displayName = "AlertDescription";
