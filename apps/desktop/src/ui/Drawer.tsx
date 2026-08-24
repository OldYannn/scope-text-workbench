import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { IconButton } from "./Button";
import { Tooltip } from "./Tooltip";

type DrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  testId?: string;
  children: ReactNode;
};

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  returnFocusRef,
  testId,
  children,
}: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content
          className="drawer-content"
          data-testid={testId}
          onEscapeKeyDown={() => onOpenChange(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onOpenChange(false);
          }}
          onCloseAutoFocus={(event) => {
            if (!returnFocusRef?.current) return;
            event.preventDefault();
            returnFocusRef.current.focus();
          }}
        >
          <div className="drawer-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && (
                <Dialog.Description>{description}</Dialog.Description>
              )}
            </div>
            <Tooltip content="关闭">
              <Dialog.Close asChild>
                <IconButton
                  aria-label="关闭"
                  data-testid={testId ? `${testId}-close` : undefined}
                >
                  <X aria-hidden="true" size={18} strokeWidth={2} />
                </IconButton>
              </Dialog.Close>
            </Tooltip>
          </div>
          <div className="drawer-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
