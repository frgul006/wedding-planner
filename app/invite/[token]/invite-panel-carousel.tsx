"use client";

import {
  Children,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cx } from "../_components/brevkort-primitives";

export type InvitePanelId = "detaljer" | "inbjudan" | "osa";

type InvitePanelMeta = {
  id: InvitePanelId;
  label: string;
};

type InvitePanelCarouselProps = {
  children: ReactNode;
  coupleMark: string;
  panels: InvitePanelMeta[];
};

type PanelTransition = {
  direction: -1 | 1;
  fromIndex: number;
  options: { replace?: boolean };
  phase: "ready" | "moving";
  sequence: number;
  toIndex: number;
};

const panelTransitionMs = 300;
const panelTransitionEase = "cubic-bezier(0.22, 1, 0.36, 1)";
const panelScaleDuringMotion = 0.985;
const swipeThresholdPx = 48;

function hashToPanelId(hash: string, panels: InvitePanelMeta[]) {
  const id = hash.replace(/^#/, "");
  return panels.find((panel) => panel.id === id)?.id ?? null;
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);

    return () => {
      mediaQuery.removeEventListener("change", syncPreference);
    };
  }, []);

  return prefersReducedMotion;
}

function formatPanelCount(index: number, total: number) {
  return `${String(index + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}`;
}

function PanelDots({
  activeIndex,
  panels,
}: {
  activeIndex: number;
  panels: InvitePanelMeta[];
}) {
  return (
    <div aria-label="Panelnavigation" className="flex items-center gap-2">
      {panels.map((panel, index) => (
        <a
          aria-current={activeIndex === index ? "step" : undefined}
          aria-label={`Gå till ${panel.label}`}
          className={cx(
            "h-2.5 rounded-full ring-1 ring-invite-walnut/30 transition hover:bg-invite-ink",
            activeIndex === index ? "w-6 bg-invite-ink" : "w-2.5 bg-invite-border-soft",
          )}
          href={`#${panel.id}`}
          key={panel.id}
        />
      ))}
    </div>
  );
}

function PanelNavigation({
  activeIndex,
  coupleMark,
  panels,
}: {
  activeIndex: number;
  coupleMark: string;
  panels: InvitePanelMeta[];
}) {
  const activePanel = panels[activeIndex] ?? panels[0];
  const firstPanel = panels[0];

  return (
    <nav
      aria-label="Inbjudans paneler"
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-invite-border-soft pb-4 text-invite-ink"
    >
      <a
        aria-label={`Till ${firstPanel?.label.toLocaleLowerCase("sv-SE") ?? "inbjudan"}`}
        className="brevkort-metadata justify-self-start text-[0.68rem] font-semibold text-invite-rust"
        href={`#${firstPanel?.id ?? "inbjudan"}`}
      >
        {coupleMark} · {formatPanelCount(activeIndex, panels.length)}
      </a>
      <PanelDots activeIndex={activeIndex} panels={panels} />
      <p className="brevkort-metadata justify-self-end text-[0.68rem] text-invite-ink">
        {activePanel?.label}
      </p>
    </nav>
  );
}

export function InvitePanelCarousel({
  children,
  coupleMark,
  panels,
}: InvitePanelCarouselProps) {
  const panelChildren = Children.toArray(children);
  const [activeIndex, setActiveIndex] = useState(0);
  const [transition, setTransition] = useState<PanelTransition | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const gestureStartRef = useRef<{ x: number; y: number } | null>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const transitionRef = useRef<PanelTransition | null>(null);
  const transitionSequenceRef = useRef(0);
  const prefersReducedMotion = usePrefersReducedMotion();

  const panelIndexById = useMemo(() => {
    return new Map(panels.map((panel, index) => [panel.id, index]));
  }, [panels]);

  const activePanel = panels[activeIndex] ?? panels[0];
  const navigationIndex = transition?.toIndex ?? activeIndex;

  useEffect(() => {
    transitionRef.current = transition;
  }, [transition]);

  const getPanelHeight = useCallback((index: number) => {
    return panelRefs.current[index]?.scrollHeight ?? 0;
  }, []);

  const updateViewportHeight = useCallback(
    (index: number) => {
      const nextHeight = getPanelHeight(index);

      if (nextHeight > 0) {
        setViewportHeight(nextHeight);
      }
    },
    [getPanelHeight],
  );

  useEffect(() => {
    const syncHeight = () => {
      const currentTransition = transitionRef.current;

      if (currentTransition) {
        updateViewportHeight(currentTransition.toIndex);
      }
    };

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncHeight);
      return () => window.removeEventListener("resize", syncHeight);
    }

    const observer = new ResizeObserver(syncHeight);

    for (const panel of panelRefs.current) {
      if (panel) {
        observer.observe(panel);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [panelChildren.length, updateViewportHeight]);

  const updateHashForIndex = useCallback(
    (nextIndex: number, options: { replace?: boolean } = {}) => {
      if (typeof window === "undefined") {
        return;
      }

      const nextPanel = panels[nextIndex];

      if (!nextPanel) {
        return;
      }

      const nextHash = `#${nextPanel.id}`;

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

  const completeTransition = useCallback(
    (sequence: number) => {
      const currentTransition = transitionRef.current;

      if (!currentTransition || currentTransition.sequence !== sequence) {
        return;
      }

      setActiveIndex(currentTransition.toIndex);
      updateHashForIndex(currentTransition.toIndex, currentTransition.options);
      transitionRef.current = null;
      setTransition(null);
    },
    [updateHashForIndex],
  );

  useEffect(() => {
    if (!transition || transition.phase !== "ready") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      updateViewportHeight(transition.toIndex);
      setTransition((currentTransition) => {
        if (!currentTransition || currentTransition.sequence !== transition.sequence) {
          return currentTransition;
        }

        return { ...currentTransition, phase: "moving" };
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [transition, updateViewportHeight]);

  useEffect(() => {
    if (!transition || transition.phase !== "moving") {
      return;
    }

    const timeout = window.setTimeout(
      () => completeTransition(transition.sequence),
      panelTransitionMs + 80,
    );

    return () => {
      window.clearTimeout(timeout);
    };
  }, [completeTransition, transition]);

  const navigateToIndex = useCallback(
    (nextIndex: number, options: { replace?: boolean } = {}) => {
      if (nextIndex < 0 || nextIndex >= panels.length) {
        return;
      }

      const pendingTargetIndex = transitionRef.current?.toIndex;

      if (pendingTargetIndex === nextIndex) {
        return;
      }

      if (nextIndex === activeIndex) {
        transitionRef.current = null;
        setTransition(null);
        updateHashForIndex(nextIndex, options);
        return;
      }

      if (prefersReducedMotion) {
        transitionRef.current = null;
        setTransition(null);
        setActiveIndex(nextIndex);
        updateHashForIndex(nextIndex, options);
        return;
      }

      const fromHeight = getPanelHeight(activeIndex);

      if (fromHeight > 0) {
        setViewportHeight(fromHeight);
      }

      const nextSequence = transitionSequenceRef.current + 1;
      const nextTransition: PanelTransition = {
        direction: nextIndex > activeIndex ? 1 : -1,
        fromIndex: activeIndex,
        options,
        phase: "ready",
        sequence: nextSequence,
        toIndex: nextIndex,
      };

      transitionSequenceRef.current = nextSequence;
      transitionRef.current = nextTransition;
      setTransition(nextTransition);
    },
    [
      activeIndex,
      getPanelHeight,
      panels.length,
      prefersReducedMotion,
      updateHashForIndex,
    ],
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
      const baseIndex = transitionRef.current?.toIndex ?? activeIndex;
      navigateToIndex(baseIndex + delta);
    },
    [activeIndex, navigateToIndex],
  );

  useEffect(() => {
    const syncFromHash = () => {
      const panelId = hashToPanelId(window.location.hash, panels);

      if (!panelId) {
        transitionRef.current = null;
        setTransition(null);
        setActiveIndex(0);
        return;
      }

      const nextIndex = panelIndexById.get(panelId);

      if (nextIndex !== undefined) {
        transitionRef.current = null;
        setTransition(null);
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

  const getPanelMotionStyle = (index: number): CSSProperties => {
    const baseStyle: CSSProperties = {
      left: 0,
      position: "absolute",
      top: 0,
      width: "100%",
    };

    if (!transition || prefersReducedMotion) {
      if (index === activeIndex) {
        return {
          opacity: 1,
          position: "relative",
          transform: "translate3d(0%, 0, 0) scale(1)",
          transition: "none",
          width: "100%",
          zIndex: 1,
        };
      }

      return {
        ...baseStyle,
        opacity: 0,
        transform: "translate3d(0%, 0, 0) scale(1)",
        transition: "none",
        zIndex: 0,
      };
    }

    const isFromPanel = index === transition.fromIndex;
    const isToPanel = index === transition.toIndex;
    const isMoving = transition.phase === "moving";
    let opacity = 0;
    let scale = panelScaleDuringMotion;
    let translateX = 0;
    let zIndex = 0;

    if (isFromPanel) {
      opacity = isMoving ? 0.82 : 1;
      scale = isMoving ? panelScaleDuringMotion : 1;
      translateX = isMoving ? -100 * transition.direction : 0;
      zIndex = 1;
    } else if (isToPanel) {
      opacity = 1;
      scale = isMoving ? 1 : panelScaleDuringMotion;
      translateX = isMoving ? 0 : 100 * transition.direction;
      zIndex = 2;
    }

    return {
      ...baseStyle,
      opacity,
      transform: `translate3d(${translateX}%, 0, 0) scale(${scale})`,
      transition:
        transition.phase === "moving"
          ? `transform ${panelTransitionMs}ms ${panelTransitionEase}, opacity ${panelTransitionMs}ms ${panelTransitionEase}`
          : "none",
      willChange: "transform, opacity",
      zIndex,
    };
  };

  const viewportStyle: CSSProperties | undefined = transition
    ? { height: viewportHeight === null ? undefined : `${viewportHeight}px` }
    : undefined;

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
      <div className="px-4 py-0 sm:px-4 sm:py-0">
        <PanelNavigation
          activeIndex={activeIndex}
          coupleMark={coupleMark}
          panels={panels}
        />
      </div>
      <div
        className="relative mt-0 overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none"
        data-testid="invite-panel-viewport"
        style={viewportStyle}
      >
        {panelChildren.map((child, index) => {
          const panel = panels[index];
          const isRestingActive = !transition && index === activeIndex;
          const isMovingPanel = Boolean(
            transition && (index === transition.fromIndex || index === transition.toIndex),
          );
          const isVisible = isRestingActive || isMovingPanel;
          const isAccessible = index === activeIndex;

          return (
            <div
              aria-hidden={isAccessible ? undefined : true}
              className={cx(
                "motion-reduce:transition-none",
                isVisible ? "visible" : "invisible pointer-events-none",
                isRestingActive ? "pointer-events-auto" : "pointer-events-none",
              )}
              inert={isAccessible ? undefined : true}
              key={panel?.id ?? index}
              onTransitionEnd={(event) => {
                if (
                  transition &&
                  index === transition.toIndex &&
                  event.target === event.currentTarget &&
                  event.propertyName === "transform"
                ) {
                  completeTransition(transition.sequence);
                }
              }}
              ref={(node) => {
                panelRefs.current[index] = node;
              }}
              style={getPanelMotionStyle(index)}
            >
              {child}
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-center justify-center gap-3 pt-6 text-invite-ink">
        <p className="sr-only">
          {formatPanelCount(activeIndex, panels.length)} · {activePanel?.label}
        </p>
        <button
          aria-controls={activePanel?.id}
          aria-label="Föregående panel"
          className={cx(
            "inline-flex h-11 w-11 items-center justify-center border border-invite-ink bg-invite-paper-light text-xl transition hover:bg-invite-paper-muted/70",
            navigationIndex === 0
              ? "cursor-not-allowed border-invite-border-soft text-invite-body opacity-45"
              : "shadow-[var(--invite-shadow)]",
          )}
          disabled={navigationIndex === 0}
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
            navigationIndex === panels.length - 1
              ? "cursor-not-allowed border-invite-border-soft text-invite-body opacity-45"
              : "shadow-[var(--invite-shadow)]",
          )}
          disabled={navigationIndex === panels.length - 1}
          onClick={() => navigateBy(1)}
          type="button"
        >
          →
        </button>
      </div>
    </div>
  );
}
