import * as React from 'react';
import { cn } from '../cn';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'ons-card flex flex-col items-center justify-center text-center gap-3 py-16 px-6',
        className,
      )}
    >
      {icon && <div className="text-3xl text-ink-400">{icon}</div>}
      <h3 className="text-lg font-medium text-ink-50">{title}</h3>
      {description && <p className="text-sm text-ink-400 max-w-sm">{description}</p>}
      {action}
    </div>
  );
}
