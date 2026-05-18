import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'record' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base = 'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border border-accent',
  secondary: 'bg-surface-elevated text-foreground hover:bg-border-strong border border-border-strong',
  ghost: 'text-foreground hover:bg-surface-elevated border border-transparent',
  record: 'bg-record text-white hover:bg-record-hover border border-record',
  subtle: 'bg-surface text-muted hover:text-foreground hover:bg-surface-elevated border border-border',
};

const sizes: Record<Size, string> = {
  sm: 'text-xs h-7 px-2.5',
  md: 'text-sm h-9 px-3',
  lg: 'text-sm h-10 px-4',
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'secondary', size = 'md', className = '', ...rest }, ref) => (
    <button ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest} />
  ),
);
Button.displayName = 'Button';
