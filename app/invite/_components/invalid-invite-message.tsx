import {
  BrevkortBodyText,
  BrevkortCard,
  BrevkortHeading,
  BrevkortKicker,
  BrevkortPage,
} from "./brevkort-primitives";

export function InvalidInviteMessage() {
  return (
    <BrevkortPage className="flex items-center justify-center px-6 py-10">
      <BrevkortCard className="w-full max-w-xl bg-invite-paper-light p-8 text-center">
        <BrevkortKicker className="text-invite-rust">Wedding Planner</BrevkortKicker>
        <BrevkortHeading className="mt-4 text-4xl" level={1}>
          Inbjudan saknas
        </BrevkortHeading>
        <BrevkortBodyText className="mt-4">
          Den här länken fungerade inte. Kontrollera adressen eller be om en ny
          inbjudningslänk.
        </BrevkortBodyText>
      </BrevkortCard>
    </BrevkortPage>
  );
}
