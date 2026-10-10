import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Draft } from "@shared/schema";
import type { InvitableTenantRole, TenantRole } from "@shared/models/tenancy";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { setActiveTenantId } from "@/lib/active-tenant";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface TeamMembership { tenantId: string; name: string; kind: string; status: string; role: TenantRole }
interface TeamContext { tenantId: string; tenantName: string; tenantKind: string; role: TenantRole; memberships: TeamMembership[] }
interface TeamMemberView { userId: string; name: string; email: string; role: TenantRole; joinedAt: string }
interface PendingInvitationView { id: string; email: string; role: InvitableTenantRole; invitedAt: string; expiresAt: string }

const roleLabel: Record<TenantRole, string> = { owner: "Owner", admin: "Admin", manager: "Manager", member: "Member" };
const roleBadgeVariant: Record<TenantRole, "default" | "secondary" | "outline"> = { owner: "default", admin: "secondary", manager: "outline", member: "outline" };

function requestError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  return fallback;
}

export function TeamSettings() {
  const cache = useQueryClient();
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailValid, setInviteEmailValid] = useState(false);
  const [inviteRole, setInviteRole] = useState<InvitableTenantRole>("member");

  const context = useQuery<TeamContext>({ queryKey: ["/api/team/context"] });
  const role = context.data?.role;
  const isManagerPlus = role === "manager" || role === "admin" || role === "owner";
  const isAdminPlus = role === "admin" || role === "owner";

  const members = useQuery<TeamMemberView[]>({ queryKey: ["/api/team/members"], enabled: isManagerPlus });
  const invitations = useQuery<PendingInvitationView[]>({ queryKey: ["/api/team/invitations"], enabled: isManagerPlus });
  const reviewQueue = useQuery<Draft[]>({ queryKey: ["/api/team/review-queue"], enabled: isManagerPlus });
  const memberNames = useMemo(() => new Map((members.data ?? []).map(member => [member.userId, member.name || member.email])), [members.data]);

  function switchWorkspace(tenantId: string) {
    setActiveTenantId(tenantId);
    window.location.reload();
  }

  const invite = useMutation({
    mutationFn: async () => { await apiRequest("POST", "/api/team/invitations", { email: inviteEmail.trim().toLowerCase(), role: inviteRole }); },
    onSuccess: () => {
      setInviteEmail("");
      setInviteEmailValid(false);
      setInviteRole("member");
      void cache.invalidateQueries({ queryKey: ["/api/team/invitations"] });
      toast({ title: "Invitation sent" });
    },
    onError: (error: unknown) => toast({ title: "Could not send invitation", description: requestError(error, "Please try again."), variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/team/invitations/${id}`); },
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ["/api/team/invitations"] }); toast({ title: "Invitation revoked" }); },
    onError: (error: unknown) => toast({ title: "Could not revoke invitation", description: requestError(error, "Please try again."), variant: "destructive" }),
  });

  const changeRole = useMutation({
    mutationFn: async ({ userId, nextRole }: { userId: string; nextRole: InvitableTenantRole }) => { await apiRequest("PATCH", `/api/team/members/${userId}`, { role: nextRole }); },
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ["/api/team/members"] }); toast({ title: "Role updated" }); },
    onError: (error: unknown) => toast({ title: "Could not update role", description: requestError(error, "Please try again."), variant: "destructive" }),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => { await apiRequest("DELETE", `/api/team/members/${userId}`); },
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ["/api/team/members"] }); toast({ title: "Member removed" }); },
    onError: (error: unknown) => toast({ title: "Could not remove member", description: requestError(error, "Please try again."), variant: "destructive" }),
  });

  const approve = useMutation({
    mutationFn: async (draft: Draft) => { await apiRequest("POST", `/api/team/drafts/${draft.id}/approve`, { content: draft.content, updatedAt: draft.updatedAt as unknown as string }); },
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ["/api/team/review-queue"] }); toast({ title: "Draft approved" }); },
    onError: (error: unknown) => toast({ title: "Could not approve draft", description: requestError(error, "Reload and try again."), variant: "destructive" }),
  });

  if (context.isLoading) return <output>Loading team settings…</output>;
  if (context.isError || !context.data) return <div role="alert">Team settings could not be loaded. <Button variant="outline" onClick={() => void context.refetch()}>Retry</Button></div>;

  return <div className="space-y-6">
    <Card>
      <CardHeader><CardTitle>Workspace</CardTitle><CardDescription>You are acting in <strong>{context.data.tenantName}</strong> as {roleLabel[role!]}.</CardDescription></CardHeader>
      {context.data.memberships.length > 1 && <CardContent className="space-y-2">
        <p className="text-sm font-medium">Switch workspace</p>
        <div className="flex flex-wrap gap-2">
          {context.data.memberships.map(membership => <Button key={membership.tenantId} type="button" variant={membership.tenantId === context.data!.tenantId ? "default" : "outline"} size="sm" data-testid={`button-switch-workspace-${membership.tenantId}`} onClick={() => switchWorkspace(membership.tenantId)}>{membership.name}</Button>)}
        </div>
      </CardContent>}
    </Card>

    {isManagerPlus && <Card>
      <CardHeader><CardTitle>Team members</CardTitle><CardDescription>Everyone with access to this workspace.</CardDescription></CardHeader>
      <CardContent className="space-y-6">
        {members.isLoading && <output>Loading members…</output>}
        {members.isError && <div role="alert">Members could not be loaded. <Button variant="outline" onClick={() => void members.refetch()}>Retry</Button></div>}
        {members.data && <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {members.data.map(member => <TableRow key={member.userId} data-testid={`row-member-${member.userId}`}>
              <TableCell><div className="font-medium">{member.name || member.email}</div><div className="text-xs text-muted-foreground">{member.email}</div></TableCell>
              <TableCell>
                {isAdminPlus && member.role !== "owner" ? <NativeSelect aria-label={`Role for ${member.name || member.email}`} className="h-9 w-32" value={member.role} disabled={changeRole.isPending} onChange={(event) => changeRole.mutate({ userId: member.userId, nextRole: event.target.value as InvitableTenantRole })}>
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </NativeSelect> : <Badge variant={roleBadgeVariant[member.role]}>{roleLabel[member.role]}</Badge>}
              </TableCell>
              <TableCell className="text-right">
                {isAdminPlus && member.role !== "owner" && <Button type="button" variant="outline" size="sm" disabled={removeMember.isPending} data-testid={`button-remove-member-${member.userId}`} onClick={() => { if (window.confirm(`Remove ${member.name || member.email} from this workspace?`)) removeMember.mutate(member.userId); }}>Remove</Button>}
              </TableCell>
            </TableRow>)}
          </TableBody>
        </Table>}

        {isAdminPlus && <div className="space-y-3 border-t pt-4">
          <p className="text-sm font-medium">Invite someone</p>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); if (inviteEmailValid && !invite.isPending) invite.mutate(); }}>
            <Field id="team-invite-email" label="Email" className="min-w-56 flex-1" render={(controlProps) => <Input {...controlProps} type="email" required maxLength={254} value={inviteEmail} onChange={(event) => { setInviteEmail(event.target.value); setInviteEmailValid(event.target.validity.valid); }} />} />
            <Field id="team-invite-role" label="Role" render={(controlProps) => <NativeSelect {...controlProps} className="w-32" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as InvitableTenantRole)}>
              <option value="member">Member</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </NativeSelect>} />
            <Button type="submit" disabled={!inviteEmailValid || invite.isPending} data-testid="button-invite-member">{invite.isPending ? "Sending…" : "Send invitation"}</Button>
          </form>

          {invitations.data && invitations.data.length > 0 && <div className="space-y-2">
            <p className="text-sm font-medium">Pending invitations</p>
            <ul className="space-y-2">
              {invitations.data.map(invitation => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm" data-testid={`row-invitation-${invitation.id}`}>
                <span>{invitation.email} &middot; {roleLabel[invitation.role]}</span>
                <Button type="button" variant="outline" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(invitation.id)}>Revoke</Button>
              </li>)}
            </ul>
          </div>}
        </div>}
      </CardContent>
    </Card>}

    {isManagerPlus && <Card>
      <CardHeader><CardTitle>Review queue</CardTitle><CardDescription>Drafts from teammates whose profile requires approval before publishing.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {reviewQueue.isLoading && <output>Loading review queue…</output>}
        {reviewQueue.isError && <div role="alert">The review queue could not be loaded. <Button variant="outline" onClick={() => void reviewQueue.refetch()}>Retry</Button></div>}
        {reviewQueue.data?.length === 0 && <p className="text-sm text-muted-foreground">Nothing is waiting for review.</p>}
        {reviewQueue.data?.map(draft => <div key={draft.id} className="space-y-2 rounded-md border p-3" data-testid={`row-review-${draft.id}`}>
          <p className="text-xs text-muted-foreground">{memberNames.get(draft.userId) ?? "Teammate"}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{draft.content}</p>
          <Button type="button" size="sm" disabled={approve.isPending} data-testid={`button-approve-${draft.id}`} onClick={() => approve.mutate(draft)}>{approve.isPending ? "Approving…" : "Approve"}</Button>
        </div>)}
      </CardContent>
    </Card>}
  </div>;
}
