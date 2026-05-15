import type { ComponentPropsWithoutRef, ReactNode } from "react";

export function cx(...classNames: Array<false | null | string | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

type BrevkortButtonTone = "ink" | "outline" | "rust" | "subtle";

type BrevkortHeadingProps = {
  children: ReactNode;
  className?: string;
  id?: string;
  level?: 1 | 2 | 3 | 4;
};

const buttonToneClasses: Record<BrevkortButtonTone, string> = {
  ink: "border-invite-ink bg-invite-ink text-invite-paper-light hover:bg-[#2a261f]",
  outline:
    "border-invite-ink bg-transparent text-invite-ink hover:bg-invite-paper-muted/45",
  rust: "border-invite-rust bg-invite-rust text-white hover:bg-[var(--invite-rust-dark)]",
  subtle:
    "border-invite-border bg-invite-paper-muted/70 text-invite-ink hover:bg-invite-paper-muted",
};

export function BrevkortPage({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"main">) {
  return (
    <main
      {...props}
      className={cx(
        "brevkort-paper min-h-dvh bg-invite-paper px-4 py-5 text-invite-ink sm:px-6 sm:py-8",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function BrevkortStack({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div {...props} className={cx("mx-auto grid w-full max-w-3xl gap-6", className)}>
      {children}
    </div>
  );
}

export function BrevkortPanel({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"article">) {
  return (
    <article
      {...props}
      className={cx(
        "scroll-mt-4 border border-invite-border/80 bg-invite-paper-light p-4 shadow-[var(--invite-shadow)] sm:p-6",
        className,
      )}
    >
      {children}
    </article>
  );
}

export function BrevkortCard({
  children,
  className,
  title,
  titleAsHeading = false,
  ...props
}: ComponentPropsWithoutRef<"section"> & { title?: string; titleAsHeading?: boolean }) {
  return (
    <section
      {...props}
      className={cx(
        "border border-invite-border-soft bg-invite-paper-muted/70 p-4 text-invite-ink",
        className,
      )}
    >
      {title && titleAsHeading ? (
        <h3 className="brevkort-metadata text-[0.68rem] font-semibold leading-5 text-invite-walnut">
          {title}
        </h3>
      ) : null}
      {title && !titleAsHeading ? (
        <BrevkortKicker className="text-invite-walnut">{title}</BrevkortKicker>
      ) : null}
      <div className={title ? "mt-4" : undefined}>{children}</div>
    </section>
  );
}

export function BrevkortKicker({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      {...props}
      className={cx(
        "brevkort-metadata text-[0.68rem] font-semibold leading-5 text-invite-walnut",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function BrevkortLegend({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"legend">) {
  return (
    <legend
      {...props}
      className={cx(
        "brevkort-metadata text-[0.68rem] font-semibold leading-5 text-invite-walnut",
        className,
      )}
    >
      {children}
    </legend>
  );
}

export function BrevkortHeading({
  children,
  className,
  id,
  level = 2,
}: BrevkortHeadingProps) {
  const headingClassName = cx(
    "brevkort-display font-semibold leading-none tracking-tight text-invite-ink",
    className,
  );

  if (level === 1) {
    return (
      <h1 className={headingClassName} id={id}>
        {children}
      </h1>
    );
  }

  if (level === 3) {
    return (
      <h3 className={headingClassName} id={id}>
        {children}
      </h3>
    );
  }

  if (level === 4) {
    return (
      <h4 className={headingClassName} id={id}>
        {children}
      </h4>
    );
  }

  return (
    <h2 className={headingClassName} id={id}>
      {children}
    </h2>
  );
}

export function BrevkortBodyText({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"p">) {
  return (
    <p {...props} className={cx("leading-7 text-invite-body", className)}>
      {children}
    </p>
  );
}

export function BrevkortRule({ className, ...props }: ComponentPropsWithoutRef<"hr">) {
  return <hr {...props} className={cx("border-invite-border-soft", className)} />;
}

export function BrevkortLinkButton({
  children,
  className,
  tone = "ink",
  ...props
}: ComponentPropsWithoutRef<"a"> & { tone?: BrevkortButtonTone }) {
  return (
    <a
      {...props}
      className={cx(
        "inline-flex min-h-12 items-center justify-center gap-3 border px-5 py-3 text-sm font-semibold uppercase tracking-[0.22em] transition",
        buttonToneClasses[tone],
        className,
      )}
    >
      {children}
    </a>
  );
}

export function BrevkortButton({
  children,
  className,
  tone = "ink",
  ...props
}: ComponentPropsWithoutRef<"button"> & { tone?: BrevkortButtonTone }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex min-h-12 items-center justify-center gap-3 border px-5 py-3 text-sm font-semibold uppercase tracking-[0.22em] transition disabled:cursor-wait disabled:opacity-60",
        buttonToneClasses[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function BrevkortStatusStrip({
  children,
  className,
  tone = "subtle",
  ...props
}: ComponentPropsWithoutRef<"div"> & { tone?: "success" | "subtle" | "warning" }) {
  const toneClassName = {
    success: "border-l-invite-success bg-invite-paper-muted/85",
    subtle: "border-l-invite-walnut bg-invite-paper-muted/85",
    warning: "border-l-invite-rust bg-[#f1d7c7]/70",
  }[tone];

  return (
    <div
      {...props}
      className={cx("border border-l-4 border-invite-border-soft p-4", toneClassName, className)}
    >
      {children}
    </div>
  );
}

type BrevkortFieldProps = {
  error?: string | null;
  label: string;
  name: string;
};

export function BrevkortTextInput({
  className,
  error,
  id,
  label,
  name,
  ...props
}: BrevkortFieldProps & ComponentPropsWithoutRef<"input">) {
  const inputId = id ?? `brevkort-${name}`;
  const ariaDescribedBy = props["aria-describedby"];

  return (
    <label className="grid gap-1.5" htmlFor={inputId}>
      <span className="brevkort-metadata text-[0.68rem] font-semibold leading-5 text-invite-walnut">
        {label}
      </span>
      <input
        {...props}
        aria-describedby={error ? `${inputId}-error` : ariaDescribedBy}
        aria-invalid={error ? true : props["aria-invalid"]}
        className={cx(
          "w-full border-0 border-b bg-transparent px-0 py-2 text-base text-invite-ink outline-none transition placeholder:text-invite-body/75 focus:ring-0",
          error
            ? "border-b-invite-danger text-invite-danger focus:border-b-invite-danger"
            : "border-b-invite-ink focus:border-b-invite-rust",
          className,
        )}
        id={inputId}
        name={name}
      />
      {error ? <BrevkortErrorText id={`${inputId}-error`}>— {error}</BrevkortErrorText> : null}
    </label>
  );
}

export function BrevkortTextarea({
  className,
  error,
  id,
  label,
  name,
  ...props
}: BrevkortFieldProps & ComponentPropsWithoutRef<"textarea">) {
  const inputId = id ?? `brevkort-${name}`;
  const ariaDescribedBy = props["aria-describedby"];

  return (
    <label className="grid gap-1.5" htmlFor={inputId}>
      <span className="brevkort-metadata text-[0.68rem] font-semibold leading-5 text-invite-walnut">
        {label}
      </span>
      <textarea
        {...props}
        aria-describedby={error ? `${inputId}-error` : ariaDescribedBy}
        aria-invalid={error ? true : props["aria-invalid"]}
        className={cx(
          "min-h-28 w-full border bg-transparent px-3 py-3 text-base text-invite-ink outline-none transition placeholder:text-invite-body/75 focus:ring-0",
          error
            ? "border-invite-danger text-invite-danger focus:border-invite-danger"
            : "border-invite-ink focus:border-invite-rust",
          className,
        )}
        id={inputId}
        name={name}
      />
      {error ? <BrevkortErrorText id={`${inputId}-error`}>— {error}</BrevkortErrorText> : null}
    </label>
  );
}

export function BrevkortChoiceCard({
  checked,
  className,
  defaultChecked,
  description,
  label,
  name,
  onChange,
  required,
  value,
}: {
  checked?: boolean;
  className?: string;
  defaultChecked?: boolean;
  description: string;
  label: string;
  name: string;
  onChange?: ComponentPropsWithoutRef<"input">["onChange"];
  required?: boolean;
  value: string;
}) {
  return (
    <label className={cx("min-w-0 cursor-pointer", className)}>
      <input
        checked={checked}
        className="peer sr-only"
        defaultChecked={defaultChecked}
        name={name}
        onChange={onChange}
        required={required}
        type="radio"
        value={value}
      />
      <span className="grid min-h-16 min-w-0 place-items-center border border-invite-border-soft bg-invite-paper-light px-3 py-3 text-center text-invite-ink transition peer-checked:border-2 peer-checked:border-invite-ink peer-focus-visible:ring-2 peer-focus-visible:ring-invite-rust/35 sm:px-4">
        <span className="brevkort-display text-xl leading-none sm:text-2xl">{label}</span>
        <span className="mt-1 text-[0.68rem] text-invite-body">{description}</span>
      </span>
    </label>
  );
}

export function BrevkortCheckbox({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"input"> & { children: ReactNode }) {
  return (
    <label
      className={cx(
        "flex gap-3 border-y border-invite-ink/80 py-3 text-sm leading-6 text-invite-ink",
        className,
      )}
    >
      <input
        {...props}
        className="mt-1 h-4 w-4 border-invite-border accent-invite-rust"
        type="checkbox"
      />
      <span>{children}</span>
    </label>
  );
}

export function BrevkortErrorText({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      {...props}
      className={cx(
        "brevkort-display text-sm italic leading-6 text-invite-danger",
        className,
      )}
      role="alert"
    >
      {children}
    </span>
  );
}
