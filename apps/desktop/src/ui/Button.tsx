import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className = "", type = "button", variant = "secondary", ...props },
    ref,
  ) => (
    <button
      {...props}
      className={`button button-${variant} ${className}`.trim()}
      ref={ref}
      type={type}
    />
  ),
);

Button.displayName = "Button";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className = "", type = "button", children, ...props }, ref) => (
    <button
      {...props}
      className={`icon-button ${className}`.trim()}
      ref={ref}
      type={type}
    >
      {children}
    </button>
  ),
);

IconButton.displayName = "IconButton";
