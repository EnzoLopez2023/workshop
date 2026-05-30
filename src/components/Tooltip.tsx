import { useState } from 'react';
import {
  useFloating, autoUpdate, offset, flip, shift,
  useHover, useFocus, useDismiss, useRole, useInteractions,
  FloatingPortal,
} from '@floating-ui/react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, placement = 'top' }: TooltipProps) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });

  const hover = useHover(context, { move: false, delay: { open: 350, close: 0 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  return (
    <>
      <span
        ref={refs.setReference}
        style={{ display: 'contents' }}
        {...getReferenceProps()}
      >
        {children}
      </span>
      {open && content && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              zIndex: 9999,
              background: 'var(--color-ink)',
              color: 'var(--color-cream)',
              fontSize: '0.75rem',
              fontWeight: 500,
              padding: '5px 10px',
              borderRadius: 7,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              letterSpacing: '0.01em',
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            }}
            {...getFloatingProps()}
          >
            {content}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
