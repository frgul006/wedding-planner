"use client";

import { Children, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cx } from "../_components/brevkort-primitives";

export type InvitePanelId = "detaljer" | "inbjudan" | "osa";

type InvitePanelMeta = {
  id: InvitePanelId;
  label: string;
};

type InvitePanelCarouselProps = {
  children: ReactNode;
  panels: InvitePanelMeta[];
};

const swipeThresholdPx = 48;

function hashToPanelId(hash: string, panels: InvitePanelMeta[]) {
  const id = hash.replace(/^#/, "");
  return panels.find((panel) => panel.id === id)?.id ?? null;
}

export function InvitePanelCarousel({ children, panels }: InvitePanelCarouselProps) {
  const panelChildren = Children.toArray(children);
  const [activeIndex, setActiveIndex] = useState(0);
  const gestureStartRef = useRef<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const panelIndexById = useMemo(() => {
    return new Map(panels.map((panel, index) => [panel.id, index]));
  }, [panels]);

  const activePanel = panels[activeIndex] ?? panels[0];

  const navigateToIndex = useCallback(
    (nextIndex: number, options: { replace?: boolean } = {}) => {
      if (nextIndex < 0 || nextIndex >= panels.length) {
        return;
      }

      setActiveIndex(nextIndex);

      if (typeof window === "undefined") {
        return;
      }

      const nextHash = `#${panels[nextIndex]?.id}`;

      if (window.location.hash === nextHash) {
        return;
      }

      if (options.replace) {
        window.history.replaceState(null, "", nextHash);
      } else {
        window.history.pushState(null, "", nextHash);
      }
    },
    [panels],
  );

  const navigateToPanel = useCallback(
    (panelId: InvitePanelId, options?: { replace?: boolean }) => {
      const nextIndex = panelIndexById.get(panelId);

      if (nextIndex === undefined) {
        return;
      }

      navigateToIndex(nextIndex, options);
    },
    [navigateToIndex, panelIndexById],
  );

  const navigateBy = useCallback(
    (delta: -1 | 1) => {
      navigateToIndex(activeIndex + delta);
    },
    [activeIndex, navigateToIndex],
  );

  useEffect(() => {
    const syncFromHash = () => {
      const panelId = hashToPanelId(window.location.hash, panels);

      if (!panelId) {
        setActiveIndex(0);
        return;
      }

      const nextIndex = panelIndexById.get(panelId);

      if (nextIndex !== undefined) {
        setActiveIndex(nextIndex);
      }
    };

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    window.addEventListener("popstate", syncFromHash);

    return () => {
      window.removeEventListener("hashchange", syncFromHash);
      window.removeEventListener("popstate", syncFromHash);
    };
  }, [panelIndexById, panels]);

  useEffect(() => {
    const root = rootRef.current;

    if (!root) {
      return;
    }

    const handlePanelAnchorClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');

      if (!anchor || !root.contains(anchor)) {
        return;
      }

      const panelId = hashToPanelId(anchor.hash, panels);

      if (!panelId) {
        return;
      }

      event.preventDefault();
      navigateToPanel(panelId);
    };

    root.addEventListener("click", handlePanelAnchorClick);

    return () => {
      root.removeEventListener("click", handlePanelAnchorClick);
    };
  }, [navigateToPanel, panels]);

  const startGesture = (x: number, y: number) => {
    gestureStartRef.current = { x, y };
  };

  const finishGesture = (x: number, y: number) => {
    const start = gestureStartRef.current;
    gestureStartRef.current = null;

    if (!start) {
      return;
    }

    const deltaX = x - start.x;
    const deltaY = y - start.y;

    if (Math.abs(deltaX) < swipeThresholdPx || Math.abs(deltaX) < Math.abs(deltaY)) {
      return;
    }

    navigateBy(deltaX < 0 ? 1 : -1);
  };

  return (
    <div
      className="mx-auto flex min-h-[926px] w-full max-w-[390px] touch-pan-y flex-col"
      data-testid="invite-panel-carousel"
      onPointerCancel={() => {
        gestureStartRef.current = null;
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") {
          startGesture(event.clientX, event.clientY);
        }
      }}
      onPointerUp={(event) => {
        if (event.pointerType === "touch") {
          finishGesture(event.clientX, event.clientY);
        }
      }}
      onTouchCancel={() => {
        gestureStartRef.current = null;
      }}
      onTouchEnd={(event) => {
        const touch = event.changedTouches.item(0);

        if (touch) {
          finishGesture(touch.clientX, touch.clientY);
        }
      }}
      onTouchStart={(event) => {
        const touch = event.touches.item(0);

        if (touch) {
          startGesture(touch.clientX, touch.clientY);
        }
      }}
      ref={rootRef}
    >
      {panelChildren.map((child, index) => {
        const panel = panels[index];
        const isActive = index === activeIndex;

        return (
          <div
            aria-hidden={isActive ? undefined : true}
            hidden={!isActive}
            key={panel?.id ?? index}
          >
            {child}
          </div>
        );
      })}

      <div className="mt-auto flex items-center justify-center gap-3 text-invite-ink">
        <p className="sr-only">
          {String(activeIndex + 1).padStart(2, "0")}/03 · {activePanel?.label}
        </p>
        <button
          aria-controls={activePanel?.id}
          aria-label="Föregående panel"
          className={cx(
            "inline-flex h-11 w-11 items-center justify-center border border-invite-ink bg-invite-paper-light text-xl transition hover:bg-invite-paper-muted/70",
            activeIndex === 0
              ? "cursor-not-allowed border-invite-border-soft text-invite-body opacity-45"
              : "shadow-[var(--invite-shadow)]",
          )}
          disabled={activeIndex === 0}
          onClick={() => navigateBy(-1)}
          type="button"
        >
          ←
        </button>
        <button
          aria-controls={activePanel?.id}
          aria-label="Nästa panel"
          className={cx(
            "inline-flex h-11 w-11 items-center justify-center border border-invite-ink bg-invite-paper-light text-xl transition hover:bg-invite-paper-muted/70",
            activeIndex === panels.length - 1
              ? "cursor-not-allowed border-invite-border-soft text-invite-body opacity-45"
              : "shadow-[var(--invite-shadow)]",
          )}
          disabled={activeIndex === panels.length - 1}
          onClick={() => navigateBy(1)}
          type="button"
        >
          →
        </button>
      </div>
    </div>
  );
}
