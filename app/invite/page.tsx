import type { Metadata } from "next";
import { connection } from "next/server";

import { getInviteSupportContact } from "@/lib/invite-support-contact";

import { InvalidInviteMessage } from "./_components/invalid-invite-message";

export const metadata: Metadata = {
  title: "Invite | Wedding Planner",
};

export default async function MissingInviteTokenPage() {
  await connection();

  const supportContact = await getInviteSupportContact();

  return <InvalidInviteMessage supportContact={supportContact} />;
}
