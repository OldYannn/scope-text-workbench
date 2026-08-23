type NotificationProps = {
  message: string | null;
};

export function Notification({ message }: NotificationProps) {
  if (!message) return null;

  return (
    <div className="notification" role="status" aria-live="polite">
      {message}
    </div>
  );
}
