import ApprovalPolling from '@/features/onboard/components/ApprovalPolling';
import SignOutButton from '@/components/control/SignOutButton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { auth } from '@/lib/auth';
import { Mail, Phone } from 'lucide-react';

export default async function RejectedPage() {
  const session = await auth();
  const rejectReason = session?.user?.rejectReason ?? null;

  return (
    <div className="flex min-h-screen flex-col gap-6 items-center justify-center p-4">
      <ApprovalPolling />
      <Card className="w-full max-w-md gap-0">
        <CardHeader>
          <CardTitle>Account rejected</CardTitle>
          <CardDescription className="space-y-4">
            <p>
              Your account is rejected.
              <br />
              Please contact the administrator.
            </p>
            {rejectReason ? (
              <div className="rounded-md border bg-muted/50 p-3">
                <p className="text-sm font-medium text-muted-foreground mb-1">
                  Reason:
                </p>
                <p className="text-sm">{rejectReason}</p>
              </div>
            ) : null}
            <div className="flex flex-col items-end gap-1">
              <p className="flex items-center gap-1 text-blue-500">
                <Mail size={14} />
                <a
                  href="mailto:order@cmarket.ca"
                  className="underline text-blue-500"
                >
                  order@cmarket.ca
                </a>
              </p>
              <p className="flex items-center gap-1 text-blue-500">
                <Phone size={14} />
                <a href="tel:+16046908181" className="underline">
                  +1 (604) 690-8181
                </a>
              </p>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent></CardContent>
      </Card>
      <SignOutButton variant="ghost" className="text-gray-500" />
    </div>
  );
}
