import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Platform, ThemeInfo } from "../platform/types";

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export function Spinner({ large }: { large?: boolean }) {
  return <span className={cx("spinner", large && "lg")} role="status" aria-label="Loading" />;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "default", size = "md", block, loading, icon, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        "btn",
        variant !== "default" && `btn-${variant}`,
        size !== "md" && `btn-${size}`,
        block && "btn-block",
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  pressed?: boolean;
}

export function IconButton({ label, pressed, children, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cx("icon-btn", className)}
      aria-label={label}
      title={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      {...rest}
    >
      {children}
    </button>
  );
}

const BANNER_ICONS = { info: Info, warn: AlertTriangle, danger: XCircle, ok: CheckCircle2 };

export function Banner({
  tone,
  title,
  children,
  actions,
}: {
  tone: keyof typeof BANNER_ICONS;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const Icon = BANNER_ICONS[tone];
  return (
    <div className={cx("banner", tone)} role={tone === "danger" || tone === "warn" ? "alert" : "status"}>
      <Icon aria-hidden />
      <div className="banner-body">
        {title && <div className="banner-title">{title}</div>}
        {children && <div>{children}</div>}
        {actions && <div className="row" style={{ flexWrap: "wrap" }}>{actions}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  fill,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  fill?: boolean;
  label: string;
}) {
  return (
    <div className={cx("segmented", fill && "fill")} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(v),
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  onCommit?: () => void;
}) {
  const id = `s-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <div className="slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--fill" as string]: fill }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2cf86" />
          <stop offset="0.5" stopColor="#c99640" />
          <stop offset="1" stopColor="#8d6322" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14.5" fill="#1f1d26" stroke="url(#bm-g)" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="url(#bm-g)" strokeWidth="0.8" strokeOpacity="0.6" />
      <path d="M16 7.5Q16 16 24.5 16Q16 16 16 24.5Q16 16 7.5 16Q16 16 16 7.5Z" fill="url(#bm-g)" />
    </svg>
  );
}

/** Mirrors Owlbear's light/dark theme and paper colour. */
export function useTheme(platform: Platform | null): void {
  useEffect(() => {
    if (!platform) return;
    const apply = (theme: ThemeInfo) => {
      const root = document.documentElement;
      root.dataset.theme = theme.mode === "LIGHT" ? "light" : "dark";
      if (theme.paper) root.style.setProperty("--paper", theme.paper);
    };
    void platform.getTheme().then(apply).catch(() => undefined);
    return platform.onThemeChange(apply);
  }, [platform]);
}

/** Debounced copy of a value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
