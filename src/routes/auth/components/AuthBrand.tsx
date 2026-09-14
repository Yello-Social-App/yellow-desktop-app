interface AuthBrandProps {
  tagline: string;
}

/** The mark and wordmark that sit above every auth canvas. */
export function AuthBrand({ tagline }: AuthBrandProps) {
  return (
    <div className="mb-lg flex flex-col items-center text-center">
      <span
        aria-hidden
        className="bg-primary-container text-on-primary-container font-display shadow-glow mb-md grid size-14 place-items-center rounded-2xl text-[28px] font-extrabold"
      >
        Y
      </span>
      <h1 className="font-display text-display text-on-surface">Yello</h1>
      <p className="text-on-surface-variant mt-1 text-[14px]">{tagline}</p>
    </div>
  );
}
