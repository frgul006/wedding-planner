"use client";

import {
  Children,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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

type PanelNavigationHistory = "none" | "push" | "replace";

type PanelNavigationOptions = {
  history?: PanelNavigationHistory;
};

type PanelTransition = {
  direction: -1 | 1;
  fromIndex: number;
  options: PanelNavigationOptions;
  phase: "ready" | "moving";
  sequence: number;
  toIndex: number;
};

type PanelGesture = {
  direction: -1 | 1;
  fromIndex: number;
  offsetPx: number;
  phase: "dragging" | "settling";
  sequence: number;
  settle: "commit" | "snapback" | null;
  targetIndex: number | null;
  viewportWidth: number;
};

type DragSession = {
  fromIndex: number;
  intent: "horizontal" | "pending" | "vertical";
  lastTimestamp: number;
  lastX: number;
  pointerId: number;
  startTimestamp: number;
  startX: number;
  startY: number;
  viewportWidth: number;
};

const panelTransitionMs = 300;
const panelTransitionEase = "cubic-bezier(0.22, 1, 0.36, 1)";
const panelScaleDuringMotion = 0.985;
const browserGestureEdgeReservePx = 44;
const dragActivationThresholdPx = 8;
const dragCommitDistanceMaxPx = 120;
const dragCommitDistanceRatio = 0.28;
const dragFlickMinimumDistancePx = 36;
const dragFlickVelocityPxPerMs = 0.5;
const dragVerticalIntentThresholdPx = 10;
const duplicateBrowserEdgeHistoryEventWindowMs = 250;
const edgeResistanceFactor = 0.24;
const edgeResistanceLimitPx = 56;
const legacySwipeThresholdPx = 48;
const nativeBrowserEdgeGestureWindowMs = 4_000;

function hashToPanelId(hash: string, panels: InvitePanelMeta[]) {
  const id = hash.replace(/^#/, "");
  return panels.find((panel) => panel.id === id)?.id ?? null;
}

function normalizeSearchParams(search: string) {
  const entries = Array.from(new URLSearchParams(search).entries()).sort(
    ([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyComparison = leftKey.localeCompare(rightKey);
      return keyComparison === 0
        ? leftValue.localeCompare(rightValue)
        : keyComparison;
    },
  );

  return new URLSearchParams(entries).toString();
}

function getAnchorPanelTarget(
  anchor: HTMLAnchorElement,
  panels: InvitePanelMeta[],
) {
  const href = anchor.getAttribute("href");

  if (
    !href ||
    (anchor.target && anchor.target !== "_self") ||
    anchor.hasAttribute("download")
  ) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }

  const currentUrl = new URL(window.location.href);
  const hrefBeforeHash = href.split("#", 1)[0] ?? "";
  const changesSearch =
    hrefBeforeHash.includes("?") &&
    normalizeSearchParams(url.search) !== normalizeSearchParams(currentUrl.search);

  if (
    url.origin !== currentUrl.origin ||
    url.pathname !== currentUrl.pathname ||
    changesSearch
  ) {
    return null;
  }

  return hashToPanelId(url.hash, panels);
}

function getMotionReviewReducedMotionOverride() {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  const { hostname, search } = window.location;
  const isLocalReviewHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost");

  return isLocalReviewHost && new URLSearchParams(search).get("motionReviewReduced") === "1";
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(
      mediaQuery.matches || getMotionReviewReducedMotionOverride(),
    );

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

const interactiveDragStartSelector = [
  "a[href]",
  "button",
  "input",
  "label",
  "option",
  "select",
  "summary",
  "textarea",
  "[contenteditable='']",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='link']",
  "[role='radio']",
  "[role='switch']",
].join(",");

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getDragCommitDistance(viewportWidth: number) {
  return Math.min(dragCommitDistanceMaxPx, viewportWidth * dragCommitDistanceRatio);
}

function getEdgeResistanceOffset(deltaX: number) {
  const distance = Math.min(Math.abs(deltaX) * edgeResistanceFactor, edgeResistanceLimitPx);
  return Math.sign(deltaX) * distance;
}

function isInteractiveDragStart(target: EventTarget | null, root: Element) {
  if (!(target instanceof Element)) {
    return false;
  }

  const interactiveElement = target.closest(interactiveDragStartSelector);
  return Boolean(interactiveElement && root.contains(interactiveElement));
}

function isReservedBrowserGestureEdgeStart(clientX: number) {
  const viewportWidth = window.innerWidth;
  return (
    clientX <= browserGestureEdgeReservePx ||
    clientX >= viewportWidth - browserGestureEdgeReservePx
  );
}

function getGestureForDelta({
  deltaX,
  fromIndex,
  panelCount,
  phase,
  sequence,
  settle,
  viewportWidth,
}: {
  deltaX: number;
  fromIndex: number;
  panelCount: number;
  phase: PanelGesture["phase"];
  sequence: number;
  settle: PanelGesture["settle"];
  viewportWidth: number;
}): PanelGesture {
  const direction: -1 | 1 = deltaX < 0 ? 1 : -1;
  const targetIndex = fromIndex + direction;
  const hasTarget = targetIndex >= 0 && targetIndex < panelCount;
  const offsetPx = hasTarget
    ? clamp(deltaX, -viewportWidth, viewportWidth)
    : getEdgeResistanceOffset(deltaX);

  return {
    direction,
    fromIndex,
    offsetPx,
    phase,
    sequence,
    settle,
    targetIndex: hasTarget ? targetIndex : null,
    viewportWidth,
  };
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
  const [gesture, setGesture] = useState<PanelGesture | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const gestureRef = useRef<PanelGesture | null>(null);
  const gestureSequenceRef = useRef(0);
  const nativeBrowserEdgeGestureStartedAtRef = useRef<number | null>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const instantBrowserEdgeHashSyncUntilRef = useRef(0);
  const transitionRef = useRef<PanelTransition | null>(null);
  const transitionSequenceRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  const panelIndexById = useMemo(() => {
    return new Map(panels.map((panel, index) => [panel.id, index]));
  }, [panels]);

  const activePanel = panels[activeIndex] ?? panels[0];
  const navigationIndex = transition?.toIndex ?? activeIndex;

  useEffect(() => {
    transitionRef.current = transition;
  }, [transition]);

  useEffect(() => {
    gestureRef.current = gesture;
  }, [gesture]);

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
    (nextIndex: number, options: PanelNavigationOptions = {}) => {
      if (typeof window === "undefined") {
        return;
      }

      const historyMode = options.history ?? "push";

      if (historyMode === "none") {
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

      if (historyMode === "replace") {
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

  const completeGesture = useCallback(
    (sequence: number) => {
      const currentGesture = gestureRef.current;

      if (!currentGesture || currentGesture.sequence !== sequence) {
        return;
      }

      if (currentGesture.settle === "commit" && currentGesture.targetIndex !== null) {
        setActiveIndex(currentGesture.targetIndex);
        updateHashForIndex(currentGesture.targetIndex);
      }

      gestureRef.current = null;
      setGesture(null);
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

  useEffect(() => {
    if (!gesture || gesture.phase !== "settling") {
      return;
    }

    const timeout = window.setTimeout(
      () => completeGesture(gesture.sequence),
      panelTransitionMs + 80,
    );

    return () => {
      window.clearTimeout(timeout);
    };
  }, [completeGesture, gesture]);

  const settleGesture = useCallback(
    (nextGesture: PanelGesture, settle: "commit" | "snapback") => {
      const nextSettle = nextGesture.targetIndex === null ? "snapback" : settle;
      const nextSequence = gestureSequenceRef.current + 1;
      const settlingGesture: PanelGesture = {
        ...nextGesture,
        phase: "settling",
        sequence: nextSequence,
        settle: nextSettle,
      };

      gestureSequenceRef.current = nextSequence;
      gestureRef.current = settlingGesture;
      setGesture(settlingGesture);
      updateViewportHeight(
        nextSettle === "commit" && settlingGesture.targetIndex !== null
          ? settlingGesture.targetIndex
          : settlingGesture.fromIndex,
      );

      window.requestAnimationFrame(() => {
        const targetOffsetPx =
          nextSettle === "commit"
            ? -settlingGesture.direction * settlingGesture.viewportWidth
            : 0;

        setGesture((currentGesture) => {
          if (!currentGesture || currentGesture.sequence !== nextSequence) {
            return currentGesture;
          }

          return { ...currentGesture, offsetPx: targetOffsetPx };
        });
      });
    },
    [updateViewportHeight],
  );

  const cancelGestureState = useCallback(() => {
    dragSessionRef.current = null;

    if (gestureRef.current) {
      gestureSequenceRef.current += 1;
    }

    gestureRef.current = null;
    setGesture(null);
  }, []);

  const navigateToIndex = useCallback(
    (nextIndex: number, options: PanelNavigationOptions = {}) => {
      if (nextIndex < 0 || nextIndex >= panels.length) {
        return;
      }

      cancelGestureState();

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
      cancelGestureState,
      getPanelHeight,
      panels.length,
      prefersReducedMotion,
      updateHashForIndex,
    ],
  );

  const navigateToPanel = useCallback(
    (panelId: InvitePanelId, options?: PanelNavigationOptions) => {
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

  const syncHashInstantly = useCallback(
    (nextIndex: number) => {
      cancelGestureState();
      transitionRef.current = null;
      setTransition(null);
      setActiveIndex(nextIndex);
      updateViewportHeight(nextIndex);
    },
    [cancelGestureState, updateViewportHeight],
  );

  const shouldSyncBrowserEdgeNavigationInstantly = useCallback(() => {
    const now = window.performance.now();

    if (instantBrowserEdgeHashSyncUntilRef.current >= now) {
      return true;
    }

    const startedAt = nativeBrowserEdgeGestureStartedAtRef.current;

    if (startedAt === null) {
      return false;
    }

    if (now - startedAt > nativeBrowserEdgeGestureWindowMs) {
      nativeBrowserEdgeGestureStartedAtRef.current = null;
      return false;
    }

    nativeBrowserEdgeGestureStartedAtRef.current = null;
    instantBrowserEdgeHashSyncUntilRef.current =
      now + duplicateBrowserEdgeHistoryEventWindowMs;
    return true;
  }, []);

  useEffect(() => {
    const syncInitialHash = () => {
      const panelId = hashToPanelId(window.location.hash, panels);
      const nextIndex = panelId ? panelIndexById.get(panelId) : 0;

      syncHashInstantly(nextIndex ?? 0);
    };

    syncInitialHash();
  }, [panelIndexById, panels, syncHashInstantly]);

  useEffect(() => {
    const syncFromHash = () => {
      const panelId = hashToPanelId(window.location.hash, panels);
      const nextIndex = panelId ? panelIndexById.get(panelId) : 0;
      const resolvedNextIndex = nextIndex ?? 0;

      if (shouldSyncBrowserEdgeNavigationInstantly()) {
        syncHashInstantly(resolvedNextIndex);
        return;
      }

      navigateToIndex(resolvedNextIndex, { history: "none" });
    };

    window.addEventListener("hashchange", syncFromHash);
    window.addEventListener("popstate", syncFromHash);

    return () => {
      window.removeEventListener("hashchange", syncFromHash);
      window.removeEventListener("popstate", syncFromHash);
    };
  }, [
    navigateToIndex,
    panelIndexById,
    panels,
    shouldSyncBrowserEdgeNavigationInstantly,
    syncHashInstantly,
  ]);

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

      const anchor = target.closest<HTMLAnchorElement>("a[href]");

      if (!anchor || !root.contains(anchor)) {
        return;
      }

      const panelId = getAnchorPanelTarget(anchor, panels);

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

  const releasePointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Synthetic pointer events in tests do not always create a capturable pointer.
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || transitionRef.current) {
      return;
    }

    if (isReservedBrowserGestureEdgeStart(event.clientX)) {
      nativeBrowserEdgeGestureStartedAtRef.current = window.performance.now();
      return;
    }

    const currentGesture = gestureRef.current;

    if (currentGesture) {
      if (currentGesture.phase !== "settling" || currentGesture.settle !== "snapback") {
        return;
      }

      cancelGestureState();
    }

    const root = rootRef.current;

    if (!root || isInteractiveDragStart(event.target, root)) {
      return;
    }

    const viewportWidth = viewportRef.current?.clientWidth ?? root.clientWidth;
    const now = window.performance.now();

    dragSessionRef.current = {
      fromIndex: activeIndex,
      intent: "pending",
      lastTimestamp: now,
      lastX: event.clientX,
      pointerId: event.pointerId,
      startTimestamp: now,
      startX: event.clientX,
      startY: event.clientY,
      viewportWidth: Math.max(1, viewportWidth),
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in tests do not always create a capturable pointer.
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;

    if (
      !session ||
      event.pointerType !== "touch" ||
      event.pointerId !== session.pointerId
    ) {
      return;
    }

    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    const absoluteDeltaX = Math.abs(deltaX);
    const absoluteDeltaY = Math.abs(deltaY);
    const now = window.performance.now();

    session.lastX = event.clientX;
    session.lastTimestamp = now;

    if (session.intent === "vertical") {
      return;
    }

    if (session.intent === "pending") {
      if (
        absoluteDeltaY >= dragVerticalIntentThresholdPx &&
        absoluteDeltaY > absoluteDeltaX
      ) {
        session.intent = "vertical";
        dragSessionRef.current = null;
        releasePointerCapture(event);
        return;
      }

      if (absoluteDeltaX < dragActivationThresholdPx || absoluteDeltaX <= absoluteDeltaY) {
        return;
      }

      session.intent = "horizontal";
      updateViewportHeight(session.fromIndex);
    }

    event.preventDefault();

    if (prefersReducedMotion) {
      return;
    }

    const nextGesture = getGestureForDelta({
      deltaX,
      fromIndex: session.fromIndex,
      panelCount: panels.length,
      phase: "dragging",
      sequence: gestureSequenceRef.current,
      settle: null,
      viewportWidth: session.viewportWidth,
    });

    gestureRef.current = nextGesture;
    setGesture(nextGesture);
  };

  const finishDragSession = (
    event: ReactPointerEvent<HTMLDivElement>,
    options: { cancel?: boolean } = {},
  ) => {
    const session = dragSessionRef.current;

    if (
      !session ||
      event.pointerType !== "touch" ||
      event.pointerId !== session.pointerId
    ) {
      return;
    }

    dragSessionRef.current = null;
    releasePointerCapture(event);

    const currentGesture = gestureRef.current;

    if (options.cancel) {
      if (currentGesture?.phase === "dragging") {
        settleGesture(currentGesture, "snapback");
      }

      return;
    }

    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    const absoluteDeltaX = Math.abs(deltaX);
    const absoluteDeltaY = Math.abs(deltaY);
    const hasHorizontalRelease =
      session.intent === "horizontal" ||
      (absoluteDeltaX >= legacySwipeThresholdPx && absoluteDeltaX > absoluteDeltaY);

    if (session.intent === "vertical" || !hasHorizontalRelease) {
      return;
    }

    const velocityWindowMs = Math.max(1, window.performance.now() - session.lastTimestamp);
    const totalWindowMs = Math.max(1, window.performance.now() - session.startTimestamp);
    const recentVelocity = (event.clientX - session.lastX) / velocityWindowMs;
    const totalVelocity = deltaX / totalWindowMs;
    const releaseVelocity =
      Math.abs(recentVelocity) > Math.abs(totalVelocity) ? recentVelocity : totalVelocity;
    const nextGesture = getGestureForDelta({
      deltaX,
      fromIndex: session.fromIndex,
      panelCount: panels.length,
      phase: "dragging",
      sequence: gestureSequenceRef.current,
      settle: null,
      viewportWidth: session.viewportWidth,
    });
    const hasDistanceCommit =
      absoluteDeltaX >= getDragCommitDistance(session.viewportWidth);
    const hasVelocityCommit =
      absoluteDeltaX >= dragFlickMinimumDistancePx &&
      Math.abs(releaseVelocity) >= dragFlickVelocityPxPerMs &&
      Math.sign(releaseVelocity) === Math.sign(deltaX);
    const shouldCommit =
      nextGesture.targetIndex !== null && (hasDistanceCommit || hasVelocityCommit);

    if (prefersReducedMotion) {
      if (shouldCommit && nextGesture.targetIndex !== null) {
        navigateToIndex(nextGesture.targetIndex);
      }

      return;
    }

    settleGesture(nextGesture, shouldCommit ? "commit" : "snapback");
  };

  const getPanelMotionStyle = (index: number): CSSProperties => {
    const baseStyle: CSSProperties = {
      left: 0,
      position: "absolute",
      top: 0,
      width: "100%",
    };

    if (gesture && !prefersReducedMotion) {
      const isFromPanel = index === gesture.fromIndex;
      const isTargetPanel = index === gesture.targetIndex;
      const transitionStyle =
        gesture.phase === "settling"
          ? `transform ${panelTransitionMs}ms ${panelTransitionEase}, opacity ${panelTransitionMs}ms ${panelTransitionEase}`
          : "none";

      if (isFromPanel) {
        return {
          ...baseStyle,
          opacity: 1,
          transform: `translate3d(${gesture.offsetPx}px, 0, 0) scale(1)`,
          transition: transitionStyle,
          willChange: "transform, opacity",
          zIndex: 1,
        };
      }

      if (isTargetPanel) {
        const targetOffsetPx =
          gesture.offsetPx + gesture.direction * gesture.viewportWidth;

        return {
          ...baseStyle,
          opacity: 1,
          transform: `translate3d(${targetOffsetPx}px, 0, 0) scale(1)`,
          transition: transitionStyle,
          willChange: "transform, opacity",
          zIndex: 2,
        };
      }

      return {
        ...baseStyle,
        opacity: 0,
        transform: "translate3d(0px, 0, 0) scale(1)",
        transition: "none",
        zIndex: 0,
      };
    }

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

  const viewportStyle: CSSProperties | undefined = transition || gesture
    ? { height: viewportHeight === null ? undefined : `${viewportHeight}px` }
    : undefined;

  return (
    <div
      className="relative mx-auto min-h-[926px] w-full max-w-[390px] md:max-w-[44rem]"
      data-testid="invite-panel-carousel"
      onPointerCancel={(event) => finishDragSession(event, { cancel: true })}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDragSession}
      ref={rootRef}
    >
      <div
        aria-hidden="true"
        className="pointer-events-auto fixed inset-y-0 left-0 z-30"
        data-testid="invite-panel-left-browser-edge"
        style={{ width: `${browserGestureEdgeReservePx}px` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-auto fixed inset-y-0 right-0 z-30"
        data-testid="invite-panel-right-browser-edge"
        style={{ width: `${browserGestureEdgeReservePx}px` }}
      />
      <div className="flex min-h-[926px] flex-col touch-pan-y">
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
          ref={viewportRef}
          style={viewportStyle}
        >
        {panelChildren.map((child, index) => {
          const panel = panels[index];
          const isRestingActive = !transition && !gesture && index === activeIndex;
          const isMovingPanel = Boolean(
            transition && (index === transition.fromIndex || index === transition.toIndex),
          );
          const isGesturePanel = Boolean(
            gesture && (index === gesture.fromIndex || index === gesture.targetIndex),
          );
          const isVisible = isRestingActive || isMovingPanel || isGesturePanel;
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
    </div>
  );
}
