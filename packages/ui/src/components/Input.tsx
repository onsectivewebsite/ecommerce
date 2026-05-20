import * as React from 'react';
import { cn } from '../cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const inputId = id ?? React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-ink-200">
          {label}
        </label>
      )}
      <input id={inputId} ref={ref} className={cn('ons-input', error && 'border-danger focus:ring-danger/40 focus:border-danger', className)} {...rest} />
      {(hint || error) && (
        <span className={cn('text-xs', error ? 'text-danger' : 'text-ink-400')}>{error ?? hint}</span>
      )}
    </div>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const inputId = id ?? React.useId();
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-ink-200">
          {label}
        </label>
      )}
      <textarea id={inputId} ref={ref} className={cn('ons-input min-h-[120px] resize-y', className)} {...rest} />
      {(hint || error) && (
        <span className={cn('text-xs', error ? 'text-danger' : 'text-ink-400')}>{error ?? hint}</span>
      )}
    </div>
  );
});
