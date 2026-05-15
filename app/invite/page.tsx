import type { Metadata } from "next";

import { InvalidInviteMessage } from "./_components/invalid-invite-message";

export const metadata: Metadata = {
  title: "Invite | Wedding Planner",
};

export default function MissingInviteTokenPage() {
  return <InvalidInviteMessage />;
}
