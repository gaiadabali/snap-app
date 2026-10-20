import type { ComponentProps, ReactNode } from 'react';

import { cx } from '@/design/primitives/cx';

/**
 * Auth-only form pieces in the marketing kit's language (labels above,
 * 52px fields, 14px radius). Same props and markup contract as the panel
 * `Field` / `Input` / `Select`, so forms keep their `id`s and names.
 */
export function AuthField({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="auth-field" htmlFor={htmlFor}>
      <span className="auth-label">{label}</span>
      {children}
      {error ? (
        <span className="auth-hint auth-hint-error">{error}</span>
      ) : hint ? (
        <span className="auth-hint">{hint}</span>
      ) : null}
    </label>
  );
}

export function AuthInput({ className, ...rest }: ComponentProps<'input'>) {
  return <input {...rest} className={cx('auth-input', className)} />;
}

export function AuthSelect({ className, ...rest }: ComponentProps<'select'>) {
  return <select {...rest} className={cx('auth-input auth-select', className)} />;
}
