export function AdminField({
  defaultValue,
  disabled = false,
  helpText,
  label,
  name,
  placeholder,
  required = false,
  type = "text",
}: {
  defaultValue?: string | null;
  disabled?: boolean;
  helpText?: string;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
        <span>{label}</span>
        <input
          className="rounded-2xl border border-zinc-300 px-4 py-3 font-normal text-zinc-950 outline-none transition focus:border-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
          defaultValue={defaultValue ?? ""}
          disabled={disabled}
          name={name}
          placeholder={placeholder}
          required={required}
          type={type}
        />
      </label>
      {helpText ? <span className="text-xs font-normal text-zinc-500">{helpText}</span> : null}
    </div>
  );
}

export function AdminTextArea({
  defaultValue,
  helpText,
  label,
  name,
  placeholder,
  required = false,
  rows = 4,
}: {
  defaultValue?: string | null;
  helpText?: string;
  label: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
        <span>{label}</span>
        <textarea
          className="rounded-2xl border border-zinc-300 px-4 py-3 font-normal text-zinc-950 outline-none transition focus:border-zinc-950"
          defaultValue={defaultValue ?? ""}
          name={name}
          placeholder={placeholder}
          required={required}
          rows={rows}
        />
      </label>
      {helpText ? <span className="text-xs font-normal text-zinc-500">{helpText}</span> : null}
    </div>
  );
}
