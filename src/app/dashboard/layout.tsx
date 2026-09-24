import { Wordmark } from "@/components/wordmark";
import { requireUser } from "@/server/session";
import { SignOut } from "./sign-out";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Wordmark href="/dashboard" />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-3 sm:inline">{user.email}</span>
            <SignOut />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
