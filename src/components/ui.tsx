/**
 * The component layer.
 *
 * A small set of primitives built on the design tokens in globals.css. Every
 * screen is assembled from these, so spacing, focus rings, and disabled states
 * stay consistent without any screen restating them.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import type { Priority } from '@/lib/validation';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

const buttonVariants: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-accent-foreground hover:opacity-90',
  secondary: 'bg-surface text-foreground border border-line hover:bg-surface-muted',
  ghost: 'text-muted hover:text-foreground hover:bg-surface-muted',
  danger: 'bg-danger-soft text-danger border border-danger/25 hover:bg-danger/10',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5 text-sm',
        buttonVariants[variant],
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Form field wrapper                                                         */
/* -------------------------------------------------------------------------- */

const controlBase =
  'w-full rounded-lg border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted/60 transition disabled:opacity-50';

/**
 * Wraps a control with its label, error, and hint, and wires up the aria
 * attributes so a screen reader announces the error with the field rather than
 * leaving it as loose text on the page.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  invalid,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${props.id}-error` : undefined}
      className={cx(controlBase, invalid ? 'border-danger' : 'border-line', focusRing, className)}
      {...props}
    />
  );
}

export function Textarea({
  invalid,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${props.id}-error` : undefined}
      className={cx(
        controlBase,
        'min-h-24 resize-y',
        invalid ? 'border-danger' : 'border-line',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  invalid,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${props.id}-error` : undefined}
      className={cx(
        controlBase,
        'cursor-pointer appearance-none bg-no-repeat pr-9',
        invalid ? 'border-danger' : 'border-line',
        focusRing,
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b6b66' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundPosition: 'right 0.75rem center',
      }}
      {...props}
    >
      {children}
    </select>
  );
}

/* -------------------------------------------------------------------------- */
/* Display                                                                    */
/* -------------------------------------------------------------------------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx('rounded-xl border border-line bg-surface', className)}>{children}</div>
  );
}

const priorityStyles: Record<Priority, string> = {
  high: 'bg-priority-high-soft text-priority-high',
  medium: 'bg-priority-medium-soft text-priority-medium',
  low: 'bg-priority-low-soft text-priority-low',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        priorityStyles[priority],
      )}
    >
      {priority}
    </span>
  );
}

/** Inline status message. `tone` picks the colour; the role makes it announced. */
export function Notice({
  tone,
  children,
  onDismiss,
}: {
  tone: 'error' | 'success';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const isError = tone === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={cx(
        'flex items-start justify-between gap-3 rounded-lg border px-3.5 py-3 text-sm',
        isError
          ? 'border-danger/25 bg-danger-soft text-danger'
          : 'border-success/25 bg-success-soft text-success',
      )}
    >
      <span>{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={cx('shrink-0 rounded px-1 opacity-60 hover:opacity-100', focusRing)}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-line border-t-accent"
      />
      {label}
    </span>
  );
}

/** Centred placeholder for the empty and no-results states. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
