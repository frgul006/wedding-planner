export function InvalidInviteMessage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f1eadc] px-6 py-10 text-[#15130f]">
      <section className="w-full max-w-xl rounded-[2rem] bg-[#e6dcc7] p-8 text-center shadow-xl shadow-[#6f4f33]/10 ring-1 ring-[#6f4f33]/15">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.26em] text-[#6f4f33]">
          Wedding Planner
        </p>
        <h1 className="mt-4 font-serif text-4xl font-semibold tracking-tight text-[#15130f]">
          Inbjudan saknas
        </h1>
        <p className="mt-4 leading-7 text-[#3b2b1f]">
          Den här länken fungerade inte. Kontrollera adressen eller be om en ny
          inbjudningslänk.
        </p>
      </section>
    </main>
  );
}
