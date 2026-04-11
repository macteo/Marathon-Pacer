(function () {
  "use strict";

  const STORAGE_KEY = "marathon-pacer-state-v1";

  /** @typedef {{id:string, distance:number, paceMin:number, paceSec:number}} Segment */
  /** @typedef {{id:string, type:"segment", segment:Segment}} SegmentBlock */
  /** @typedef {{id:string, type:"group", repeats:number, segments:Segment[]}} GroupBlock */
  /** @typedef {SegmentBlock|GroupBlock} Block */

  // Sensible defaults so new fields are pre-filled and live updates are
  // visible immediately — the user shouldn't have to type every box from
  // scratch before the totals start moving.
  const DEFAULT_DISTANCE_KM = 1;
  const DEFAULT_PACE_MIN = 5;
  const DEFAULT_PACE_SEC = 0;

  // Selectable ranges for the dropdowns. Pace minutes covers elite
  // running (2'/km) up to easy jogging (8'/km). Repeats covers the
  // typical range for interval workouts.
  const PACE_MIN_MIN = 2;
  const PACE_MIN_MAX = 8;
  const REPEATS_MIN = 1;
  const REPEATS_MAX = 15;

  function populateOptions(selectEl, min, max, current) {
    while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);
    for (let i = min; i <= max; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = String(i);
      if (i === current) opt.selected = true;
      selectEl.appendChild(opt);
    }
  }

  /** @type {{target:number, blocks:Block[], finalPaceMin:number, finalPaceSec:number}} */
  let state = {
    target: 42.195,
    blocks: [],
    finalPaceMin: DEFAULT_PACE_MIN,
    finalPaceSec: DEFAULT_PACE_SEC,
  };

  // ----- Utilities -----
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const uid = () => Math.random().toString(36).slice(2, 10);

  const clampNum = (v, min, max) => {
    if (isNaN(v)) return min;
    return Math.max(min, Math.min(max, v));
  };

  const parseNum = (v, fallback = 0) => {
    if (v === "" || v === null || v === undefined) return fallback;
    // Accept European decimal separator: "4,25" → 4.25.
    const s = typeof v === "string" ? v.replace(",", ".") : v;
    const n = Number(s);
    return isNaN(n) ? fallback : n;
  };

  const formatDistance = (km) => {
    if (!isFinite(km) || km <= 0) return "0 m";
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(3)} km`;
  };

  // Numeric-only distance (no unit), for value boxes that already show
  // "km" as an inline label on the left.
  const formatDistanceBare = (km) => {
    if (!isFinite(km) || km <= 0) return "0";
    return km.toFixed(3);
  };

  const formatHMS = (seconds) => {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    const pad = (n) => String(n).padStart(2, "0");
    // Drop the hour field entirely when it's zero, and never pad the
    // leading hour digit. "03:12:51" → "3:12:51", "00:09:31" → "9:31".
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  };

  const formatPace = (secPerKm) => {
    if (!isFinite(secPerKm) || secPerKm <= 0) return "—";
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return `${m}'${String(s).padStart(2, "0")}"/km`;
  };

  const paceToSeconds = (min, sec) => (parseNum(min) * 60) + parseNum(sec);

  // ----- State management -----
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Cannot save state:", e);
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state = Object.assign(state, parsed);
        if (!Array.isArray(state.blocks)) state.blocks = [];
      }
    } catch (e) {
      console.warn("Cannot load state:", e);
    }
  }

  function makeSegment(
    distance = DEFAULT_DISTANCE_KM,
    paceMin = DEFAULT_PACE_MIN,
    paceSec = DEFAULT_PACE_SEC
  ) {
    return { id: uid(), distance, paceMin, paceSec };
  }

  function addSegmentBlock() {
    state.blocks.push({
      id: uid(),
      type: "segment",
      segment: makeSegment(),
    });
  }

  function addGroupBlock() {
    state.blocks.push({
      id: uid(),
      type: "group",
      repeats: 10,
      segments: [makeSegment(), makeSegment()],
    });
  }

  function deleteBlock(id) {
    state.blocks = state.blocks.filter((b) => b.id !== id);
  }

  function findBlock(id) {
    return state.blocks.find((b) => b.id === id);
  }

  // ----- Calculations -----
  function computeBlockDistance(block) {
    if (block.type === "segment") {
      return parseNum(block.segment.distance);
    }
    const inner = block.segments.reduce((sum, s) => sum + parseNum(s.distance), 0);
    return inner * Math.max(1, parseNum(block.repeats, 1));
  }

  function computeBlockSeconds(block) {
    if (block.type === "segment") {
      const s = block.segment;
      return parseNum(s.distance) * paceToSeconds(s.paceMin, s.paceSec);
    }
    const innerSeconds = block.segments.reduce(
      (sum, s) => sum + parseNum(s.distance) * paceToSeconds(s.paceMin, s.paceSec),
      0
    );
    return innerSeconds * Math.max(1, parseNum(block.repeats, 1));
  }

  function computeTotals() {
    let distance = 0;
    let seconds = 0;
    for (const b of state.blocks) {
      distance += computeBlockDistance(b);
      seconds += computeBlockSeconds(b);
    }
    return { distance, seconds };
  }

  function computeFinal() {
    const { distance, seconds } = computeTotals();
    const remaining = Math.max(0, state.target - distance);
    const finalPaceSec =
      state.finalPaceMin != null || state.finalPaceSec != null
        ? paceToSeconds(state.finalPaceMin || 0, state.finalPaceSec || 0)
        : 0;
    const finalSeconds = remaining * finalPaceSec;
    return {
      segmentsDistance: distance,
      segmentsSeconds: seconds,
      remaining,
      finalSeconds,
      totalDistance: distance + remaining,
      totalSeconds: seconds + finalSeconds,
    };
  }

  // ----- Rendering -----
  const blocksEl = $("#blocks");
  const segTpl = $("#segment-template");
  const groupTpl = $("#group-template");

  // Clamp into [min, max]; if the user typed something out of range, also
  // overwrite the input element so they immediately see the corrected
  // value (e.g. typing "99" in seconds reverts to "59").
  function clampInputValue(input, value, min, max) {
    if (!isFinite(value)) return min;
    if (value > max) {
      input.value = String(max);
      return max;
    }
    if (value < min) {
      input.value = String(min);
      return min;
    }
    return value;
  }

  function renderSegmentRow(seg, onDelete) {
    const node = segTpl.content.firstElementChild.cloneNode(true);
    const dist = $(".seg-distance", node);
    const mi = $(".seg-min", node);
    const se = $(".seg-sec", node);
    const del = $(".seg-del", node);

    // Distance + seconds: free-form text. Minutes: dropdown.
    dist.value = seg.distance == null ? "" : String(seg.distance);
    se.value = seg.paceSec == null ? "" : String(seg.paceSec);

    // Snap stored paceMin into the dropdown's range so an out-of-range
    // value loaded from old localStorage doesn't display blank.
    const clampedMin = Math.min(
      PACE_MIN_MAX,
      Math.max(PACE_MIN_MIN, seg.paceMin || PACE_MIN_MIN)
    );
    if (clampedMin !== seg.paceMin) seg.paceMin = clampedMin;
    populateOptions(mi, PACE_MIN_MIN, PACE_MIN_MAX, clampedMin);

    dist.addEventListener("input", () => {
      seg.distance = parseNum(dist.value);
      recalc();
    });
    mi.addEventListener("change", () => {
      seg.paceMin = parseNum(mi.value);
      recalc();
    });
    se.addEventListener("input", () => {
      seg.paceSec = clampInputValue(se, parseNum(se.value), 0, 59);
      recalc();
    });
    del.addEventListener("click", onDelete);

    return node;
  }

  function attachDragHandle(handleEl, blockId) {
    if (!handleEl) return;
    // iOS Safari: native touch events are the only reliable way to
    // preventDefault() and stop the browser's scroll recogniser.
    // touchmove/end are attached directly to the handle element on
    // drag start — touch events are always dispatched to the original
    // touchstart target, so even if the finger leaves the handle, the
    // listeners keep firing. Document-level touchmove listeners are
    // unreliable on iOS: {passive: false} is silently ignored on some
    // versions and preventDefault no-ops, letting the page scroll.
    handleEl.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches && e.touches.length > 1) return;
        startDrag(e, blockId, /*isTouch*/ true, handleEl);
      },
      { passive: false }
    );
    // Desktop / mouse.
    handleEl.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      startDrag(e, blockId, /*isTouch*/ false, handleEl);
    });
  }

  function applyRowTint(row, color) {
    if (row && color && color.bg) row.style.backgroundColor = color.bg;
  }

  function renderBlocks() {
    blocksEl.innerHTML = "";

    if (state.blocks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "No segments yet. Add one above to get started.";
      blocksEl.appendChild(empty);
      return;
    }

    // Shared color mapping between rows and the chart.
    const colorMap = assignSegmentColors(state.blocks);

    for (const block of state.blocks) {
      if (block.type === "segment") {
        const row = renderSegmentRow(block.segment, () => {
          deleteBlock(block.id);
          update();
        });
        row.setAttribute("data-block-id", block.id);
        applyRowTint(row, colorMap.get(block.segment.id));
        attachDragHandle(row.querySelector(".drag-handle"), block.id);
        blocksEl.appendChild(row);
      } else {
        const node = groupTpl.content.firstElementChild.cloneNode(true);
        node.setAttribute("data-block-id", block.id);
        const repeatsInput = $(".group-repeats", node);
        const segWrap = $(".group-segments", node);
        const addBtn = $(".group-add-seg", node);
        const delBtn = $(".group-del", node);

        // Snap into the dropdown range, then populate.
        const clampedReps = Math.min(
          REPEATS_MAX,
          Math.max(REPEATS_MIN, parseNum(block.repeats, REPEATS_MIN))
        );
        if (clampedReps !== block.repeats) block.repeats = clampedReps;
        populateOptions(repeatsInput, REPEATS_MIN, REPEATS_MAX, clampedReps);
        repeatsInput.addEventListener("change", () => {
          block.repeats = parseNum(repeatsInput.value, REPEATS_MIN);
          recalc();
        });
        delBtn.addEventListener("click", () => {
          deleteBlock(block.id);
          update();
        });
        addBtn.addEventListener("click", () => {
          const newSeg = makeSegment();
          block.segments.push(newSeg);
          const row = renderSegmentRow(newSeg, () => {
            block.segments = block.segments.filter((s) => s.id !== newSeg.id);
            update();
          });
          segWrap.appendChild(row);
          // The new segment doesn't have a color yet — full re-render
          // after recalc assigns it one on the next update().
          recalc();
        });

        for (const seg of block.segments) {
          const row = renderSegmentRow(seg, () => {
            block.segments = block.segments.filter((s) => s.id !== seg.id);
            update();
          });
          applyRowTint(row, colorMap.get(seg.id));
          segWrap.appendChild(row);
        }

        // Drag the whole group by its head handle.
        attachDragHandle(node.querySelector(".group-head .drag-handle"), block.id);
        blocksEl.appendChild(node);
      }
    }
  }

  // ----- Drag & drop reordering of top-level blocks -----
  //
  // On iOS Safari the only reliable way to block the page scroll and
  // keep the gesture flowing is:
  //   1. Register touchstart on the handle with {passive: false} and
  //      call preventDefault().
  //   2. Register touchmove on document with {passive: false} INSIDE
  //      the touchstart handler, then preventDefault in touchmove too.
  //   3. Keep listening on document (not the handle) so re-renders
  //      that destroy the handle mid-drag don't kill the gesture —
  //      document survives forever.
  // Pointer events / setPointerCapture are not used because iOS
  // Safari's scroll recogniser can still steal capture on vertical
  // motion before capture takes effect.
  let dragState = null;

  function getClientY(e) {
    if (e.touches && e.touches.length) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0].clientY;
    return e.clientY;
  }

  function applyDraggingStyles(el) {
    if (!el) return;
    el.classList.add("is-dragging");
    el.style.position = "relative";
    el.style.zIndex = "10";
    el.style.willChange = "transform";
  }

  function clearDraggingStyles(el) {
    if (!el) return;
    el.classList.remove("is-dragging");
    el.style.transform = "";
    el.style.position = "";
    el.style.zIndex = "";
    el.style.willChange = "";
  }

  function startDrag(e, blockId, isTouch, handleEl) {
    e.preventDefault();
    if (dragState) return;

    const blockEl = blocksEl.querySelector(`[data-block-id="${blockId}"]`);
    if (!blockEl) return;

    // Snapshot every top-level block's natural top + height. These
    // values are the ground truth for the rest of the gesture — we
    // never re-measure (a re-measure would include our own transforms
    // and lie about the layout), so the threshold + slot math always
    // refers back to these stable numbers.
    const cachedPositions = state.blocks
      .map((b) => {
        const el = blocksEl.querySelector(`[data-block-id="${b.id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { el, blockId: b.id, top: r.top, height: r.height };
      })
      .filter(Boolean);

    // Read the flex gap between blocks so the slot math works for any
    // value of .blocks { gap: ... } in CSS.
    let gap = 10;
    try {
      const cs = window.getComputedStyle(blocksEl);
      const parsed = parseFloat(cs.rowGap || cs.gap);
      if (isFinite(parsed) && parsed >= 0) gap = parsed;
    } catch (err) {}

    const startY = getClientY(e);
    dragState = {
      blockId,
      isTouch,
      blockEl,
      handleEl,
      startY,
      lastY: startY,
      desiredIdx: state.blocks.findIndex((b) => b.id === blockId),
      cachedPositions,
      gap,
    };
    applyDraggingStyles(blockEl);
    // Belt-and-suspenders: kill scrolling on the whole document for the
    // entire drag, in case any individual touch-action trick fails.
    document.body.style.touchAction = "none";
    document.documentElement.style.touchAction = "none";

    if (isTouch) {
      // Listen on the HANDLE element directly. Touch events are always
      // dispatched to the original touchstart target, so even if the
      // finger leaves the handle, our touchmove listener keeps firing.
      // We never re-render mid-drag, so the handle DOM node survives
      // for the whole gesture and the listeners stay valid.
      handleEl.addEventListener("touchmove", onDragMove, { passive: false });
      handleEl.addEventListener("touchend", onDragEnd);
      handleEl.addEventListener("touchcancel", onDragEnd);
    } else {
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);
    }
  }

  function computeDesiredIdx(fingerY) {
    const { blockId, cachedPositions } = dragState;
    const nonDragged = cachedPositions.filter((p) => p.blockId !== blockId);
    let idx = nonDragged.length;
    for (let i = 0; i < nonDragged.length; i++) {
      const c = nonDragged[i];
      if (fingerY < c.top + c.height / 2) {
        idx = i;
        break;
      }
    }
    return idx;
  }

  // Push non-dragged siblings out of the way to open a slot at
  // desiredIdx. We don't mutate state — the layout is computed against
  // a virtual reordering of state.blocks, and applied as transforms.
  function applySiblingShifts(desiredIdx) {
    const { blockId, cachedPositions, gap } = dragState;

    const orderedIds = state.blocks.map((b) => b.id);
    const dragOrig = orderedIds.indexOf(blockId);
    if (dragOrig < 0) return;
    orderedIds.splice(dragOrig, 1);
    orderedIds.splice(desiredIdx, 0, blockId);

    // Walk the new order from the topmost cached position downward,
    // accumulating cached heights + the configured gap.
    const startTop = cachedPositions.length
      ? Math.min.apply(null, cachedPositions.map((c) => c.top))
      : 0;
    let curY = startTop;
    const newTops = {};
    for (const id of orderedIds) {
      const cached = cachedPositions.find((c) => c.blockId === id);
      if (!cached) continue;
      newTops[id] = curY;
      curY += cached.height + gap;
    }

    for (const cached of cachedPositions) {
      if (cached.blockId === blockId) continue;
      const target = newTops[cached.blockId];
      if (target == null) continue;
      const dy = target - cached.top;
      cached.el.style.transform = `translateY(${dy}px)`;
    }
  }

  function onDragMove(e) {
    if (!dragState) return;
    // Must be called on every move or iOS resumes scrolling.
    if (e.cancelable) e.preventDefault();
    const y = getClientY(e);
    if (y == null || !isFinite(y)) return;

    dragState.lastY = y;
    // 1. The dragged block follows the finger immediately (no
    //    transition — we override transition on .is-dragging).
    const dy = y - dragState.startY;
    dragState.blockEl.style.transform = `translateY(${dy}px)`;

    // 2. If the finger has crossed a sibling midpoint, push the
    //    siblings out of the way to open a slot for the drop. Their
    //    transition: transform makes the shift animate smoothly.
    const newDesired = computeDesiredIdx(y);
    if (newDesired !== dragState.desiredIdx) {
      dragState.desiredIdx = newDesired;
      applySiblingShifts(newDesired);
    }
  }

  function onDragEnd() {
    if (!dragState) return;
    const { blockId, blockEl, handleEl, isTouch, cachedPositions, desiredIdx } =
      dragState;

    // Tear down listeners and the global no-scroll lock first, so the
    // upcoming re-render produces a clean DOM tree.
    if (isTouch && handleEl) {
      handleEl.removeEventListener("touchmove", onDragMove);
      handleEl.removeEventListener("touchend", onDragEnd);
      handleEl.removeEventListener("touchcancel", onDragEnd);
    } else {
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
    }
    document.body.style.touchAction = "";
    document.documentElement.style.touchAction = "";

    // Clear every transform we wrote (siblings + the dragged block).
    // The browser will repaint the un-transformed layout in the same
    // tick as update() below, so the user never sees a snap-back.
    for (const cached of cachedPositions) {
      if (cached.blockId === blockId) continue;
      cached.el.style.transform = "";
    }
    clearDraggingStyles(blockEl);

    dragState = null;

    const currentIdx = state.blocks.findIndex((b) => b.id === blockId);
    if (currentIdx < 0 || currentIdx === desiredIdx) return;
    const [moved] = state.blocks.splice(currentIdx, 1);
    state.blocks.splice(desiredIdx, 0, moved);
    update();
  }

  function renderFinalAndSummary() {
    const r = computeFinal();

    $("#remaining-distance").textContent = formatDistance(r.remaining);
    $("#final-distance-label").textContent = formatDistanceBare(r.remaining);

    const finalHint = $("#final-hint");
    if (r.remaining <= 0.0005) {
      finalHint.textContent = "Your segments already cover the full target distance.";
    } else {
      const km = r.remaining;
      const finalPaceSec = paceToSeconds(state.finalPaceMin || 0, state.finalPaceSec || 0);
      if (finalPaceSec > 0) {
        finalHint.textContent = `At ${formatPace(finalPaceSec)} → ${formatHMS(km * finalPaceSec)} for this segment.`;
      } else {
        finalHint.textContent = "Set a pace for the final segment to include it in the total.";
      }
    }

    $("#total-distance").textContent = formatDistance(r.totalDistance);
    $("#total-time").textContent = formatHMS(r.totalSeconds);

    const avgPace = r.totalDistance > 0 ? r.totalSeconds / r.totalDistance : 0;
    $("#avg-pace").textContent = formatPace(avgPace);

    $("#target-label").textContent = formatDistance(state.target);
  }

  // ----- Pace chart (SVG area chart) -----
  const SVG_NS = "http://www.w3.org/2000/svg";

  function flattenSegmentsForChart() {
    const out = [];
    for (const block of state.blocks) {
      if (block.type === "segment") {
        out.push({ seg: block.segment, isFinal: false });
      } else {
        const reps = Math.max(1, Math.floor(parseNum(block.repeats, 1)));
        for (let i = 0; i < reps; i++) {
          for (const s of block.segments) out.push({ seg: s, isFinal: false });
        }
      }
    }
    const totals = computeTotals();
    const remaining = Math.max(0, state.target - totals.distance);
    if (remaining > 0.0005) {
      out.push({
        seg: {
          distance: remaining,
          paceMin: state.finalPaceMin || 0,
          paceSec: state.finalPaceSec || 0,
        },
        isFinal: true,
      });
    }
    // Drop entries with non-positive distance or pace — they can't be plotted.
    return out.filter(
      (e) =>
        parseNum(e.seg.distance) > 0 &&
        paceToSeconds(e.seg.paceMin, e.seg.paceSec) > 0
    );
  }

  function fmtPaceShort(sec) {
    const m = Math.floor(sec / 60);
    let s = Math.round(sec % 60);
    let mm = m;
    if (s === 60) {
      mm += 1;
      s = 0;
    }
    return `${mm}'${String(s).padStart(2, "0")}`;
  }

  function fmtKmShort(km) {
    if (km >= 10) return km.toFixed(1);
    return km.toFixed(2);
  }

  // Theme-aware color palette for the chart. Reading from CSS vars would
  // require getComputedStyle on every render — these constants are good
  // enough and guarantee the chart is visible regardless of CSS state.
  function chartColors() {
    const dark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return {
      grid: dark ? "#243049" : "#e5e7eb",
      label: dark ? "#9ca3af" : "#6b7280",
      finalLine: "#f59e0b",
      finalFill: "rgba(245, 158, 11, 0.35)",
      avgLine: "#ef4444",
      targetLine: dark ? "#cbd5e1" : "#475569",
    };
  }

  // Distinct colors cycled per source segment so each segment (and each
  // of its repetitions) gets a recognisable tint in the area chart AND
  // in the segment row background, so the two views agree visually.
  // `line` and `fill` are used by the chart; `bg` is a low-alpha tint
  // used as the segment row's background.
  const SEGMENT_PALETTE = [
    { line: "#0b6efd", fill: "rgba(11, 110, 253, 0.32)", bg: "rgba(11, 110, 253, 0.12)" },
    { line: "#10b981", fill: "rgba(16, 185, 129, 0.32)", bg: "rgba(16, 185, 129, 0.14)" },
    { line: "#8b5cf6", fill: "rgba(139, 92, 246, 0.32)", bg: "rgba(139, 92, 246, 0.13)" },
    { line: "#ec4899", fill: "rgba(236, 72, 153, 0.32)", bg: "rgba(236, 72, 153, 0.12)" },
    { line: "#06b6d4", fill: "rgba(6, 182, 212, 0.32)", bg: "rgba(6, 182, 212, 0.13)" },
    { line: "#f97316", fill: "rgba(249, 115, 22, 0.32)", bg: "rgba(249, 115, 22, 0.12)" },
    { line: "#84cc16", fill: "rgba(132, 204, 22, 0.32)", bg: "rgba(132, 204, 22, 0.14)" },
    { line: "#a855f7", fill: "rgba(168, 85, 247, 0.32)", bg: "rgba(168, 85, 247, 0.13)" },
  ];

  // Walk a plan's blocks in order and assign each distinct source
  // segment id a palette entry — this is the shared color mapping
  // between the segment rows and the chart, so the first segment
  // reads bluish in both places, the second green, etc.
  function assignSegmentColors(blocks) {
    const map = new Map();
    let idx = 0;
    for (const block of blocks || []) {
      if (block.type === "segment" && block.segment) {
        if (!map.has(block.segment.id)) {
          map.set(block.segment.id, SEGMENT_PALETTE[idx % SEGMENT_PALETTE.length]);
          idx++;
        }
      } else if (block.type === "group") {
        for (const seg of block.segments || []) {
          if (!map.has(seg.id)) {
            map.set(seg.id, SEGMENT_PALETTE[idx % SEGMENT_PALETTE.length]);
            idx++;
          }
        }
      }
    }
    return map;
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function renderChart() {
    const svg = $("#pace-chart");
    if (!svg) return;
    try {
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const W = 600;
      const H = 280;
      const padL = 56;
      const padR = 14;
      const padT = 14;
      const padB = 36;
      const innerW = W - padL - padR;
      const innerH = H - padT - padB;
      const colors = chartColors();

      const data = flattenSegmentsForChart();
      if (data.length === 0) {
        svg.appendChild(
          Object.assign(
            svgEl("text", {
              x: String(W / 2),
              y: String(H / 2),
              "text-anchor": "middle",
              "font-size": "14",
              "font-family":
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
              fill: colors.label,
            }),
            { textContent: "Add a segment to see your pace chart." }
          )
        );
        return;
      }

      const totalKm = data.reduce((s, e) => s + parseNum(e.seg.distance), 0);
      const paces = data.map((e) => paceToSeconds(e.seg.paceMin, e.seg.paceSec));
      const rawMin = Math.min.apply(null, paces);
      const rawMax = Math.max.apply(null, paces);
      // Pad the y range so flat plans still look reasonable.
      const span = Math.max(30, rawMax - rawMin);
      const yMin = Math.max(0, rawMin - span * 0.25);
      const yMax = rawMax + span * 0.25;

      const xScale = (km) => padL + (km / totalKm) * innerW;
      // Y axis: lower pace (faster) on TOP, slower at BOTTOM — the same
      // way race split tables are conventionally read.
      const yScale = (sec) => padT + ((sec - yMin) / (yMax - yMin)) * innerH;
      const baseY = padT + innerH;

      // ---- Grid + Y axis labels ----
      const yTicks = 4;
      for (let i = 0; i <= yTicks; i++) {
        const v = yMin + ((yMax - yMin) * i) / yTicks;
        const y = yScale(v);
        svg.appendChild(
          svgEl("line", {
            x1: String(padL),
            x2: String(W - padR),
            y1: String(y),
            y2: String(y),
            stroke: colors.grid,
            "stroke-width": "1",
            "stroke-dasharray": "3 4",
          })
        );
        const lbl = svgEl("text", {
          x: String(padL - 8),
          y: String(y + 4),
          "text-anchor": "end",
          "font-size": "12",
          "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
          fill: colors.label,
        });
        lbl.textContent = fmtPaceShort(v);
        svg.appendChild(lbl);
      }

      // ---- Per-segment coloring ----
      // Shared with the segment row backgrounds — same order, same
      // palette, so the first segment reads bluish in both places.
      const colorMap = assignSegmentColors(state.blocks);
      for (const entry of data) {
        if (entry.isFinal) {
          entry._color = { line: colors.finalLine, fill: colors.finalFill };
          continue;
        }
        const c = colorMap.get(entry.seg.id);
        entry._color = c || SEGMENT_PALETTE[0];
      }

      // ---- Draw each segment as its own filled rectangle + top line ----
      let cumKm = 0;
      let totalSec = 0;
      for (const entry of data) {
        const d = parseNum(entry.seg.distance);
        const p = paceToSeconds(entry.seg.paceMin, entry.seg.paceSec);
        const x1 = xScale(cumKm);
        const x2 = xScale(cumKm + d);
        const y = yScale(p);
        svg.appendChild(
          svgEl("path", {
            d: `M ${x1} ${baseY} L ${x1} ${y} L ${x2} ${y} L ${x2} ${baseY} Z`,
            fill: entry._color.fill,
            stroke: "none",
          })
        );
        svg.appendChild(
          svgEl("path", {
            d: `M ${x1} ${y} L ${x2} ${y}`,
            fill: "none",
            stroke: entry._color.line,
            "stroke-width": "2.5",
            "stroke-linecap": "round",
          })
        );
        cumKm += d;
        totalSec += d * p;
      }

      // ---- Average pace dashed horizontal line ----
      const avgPace = totalSec / totalKm;
      if (isFinite(avgPace) && avgPace > 0) {
        const ya = yScale(avgPace);
        svg.appendChild(
          svgEl("line", {
            x1: String(padL),
            x2: String(W - padR),
            y1: String(ya),
            y2: String(ya),
            stroke: colors.avgLine,
            "stroke-width": "1.8",
            "stroke-dasharray": "6 4",
          })
        );
        const lbl = svgEl("text", {
          x: String(W - padR - 4),
          y: String(ya - 5),
          "text-anchor": "end",
          "font-size": "11",
          "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
          fill: colors.avgLine,
        });
        lbl.textContent = "avg " + fmtPaceShort(avgPace);
        svg.appendChild(lbl);
      }

      // ---- Target distance dashed vertical line ----
      if (state.target > 0) {
        const targetKm = Math.min(state.target, totalKm);
        const xt = xScale(targetKm);
        svg.appendChild(
          svgEl("line", {
            x1: String(xt),
            x2: String(xt),
            y1: String(padT),
            y2: String(baseY),
            stroke: colors.targetLine,
            "stroke-width": "1.8",
            "stroke-dasharray": "4 4",
          })
        );
        const lbl = svgEl("text", {
          x: String(xt - 4),
          y: String(padT + 12),
          "text-anchor": "end",
          "font-size": "11",
          "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
          fill: colors.targetLine,
        });
        lbl.textContent = "target";
        svg.appendChild(lbl);
      }

      // ---- X axis labels (5 ticks) ----
      const xTicks = 5;
      for (let i = 0; i <= xTicks; i++) {
        const km = (totalKm * i) / xTicks;
        const x = xScale(km);
        const lbl = svgEl("text", {
          x: String(x),
          y: String(H - 18),
          "text-anchor": "middle",
          "font-size": "12",
          "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
          fill: colors.label,
        });
        lbl.textContent = fmtKmShort(km);
        svg.appendChild(lbl);
      }
      const unit = svgEl("text", {
        x: String(padL + innerW / 2),
        y: String(H - 4),
        "text-anchor": "middle",
        "font-size": "11",
        "font-family":
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fill: colors.label,
      });
      unit.textContent = "km";
      svg.appendChild(unit);
    } catch (err) {
      console.error("renderChart failed:", err);
    }
  }

  // Recompute totals and persist without rebuilding inputs (so the
  // on-screen keyboard keeps focus while the user is typing).
  function recalc() {
    renderFinalAndSummary();
    renderChart();
    save();
  }

  // Full re-render: only call when the structure of blocks changes
  // (add/remove block or segment), never on plain input events.
  function update() {
    renderBlocks();
    recalc();
  }

  // ----- Target controls -----
  const presetSel = $("#target-preset");
  const customWrap = $("#custom-target-wrap");
  const customInput = $("#target-custom");
  const targetValueDisplay = $("#target-value-display");

  function syncTargetInputs() {
    const presetValues = ["5", "10", "15", "21.0975", "42.195"];
    const match = presetValues.find((v) => Math.abs(Number(v) - state.target) < 1e-6);
    if (match) {
      presetSel.value = match;
      customWrap.hidden = true;
      targetValueDisplay.hidden = false;
      targetValueDisplay.textContent = formatDistance(state.target);
    } else {
      presetSel.value = "custom";
      customWrap.hidden = false;
      targetValueDisplay.hidden = true;
      customInput.value = state.target || "";
    }
  }

  presetSel.addEventListener("change", () => {
    if (presetSel.value === "custom") {
      customWrap.hidden = false;
      targetValueDisplay.hidden = true;
      // Pre-fill custom box with the current target so the user has a real
      // value to edit instead of an empty field.
      if (!customInput.value) customInput.value = String(state.target);
      customInput.focus();
      state.target = parseNum(customInput.value, state.target);
    } else {
      customWrap.hidden = true;
      targetValueDisplay.hidden = false;
      state.target = Number(presetSel.value);
      targetValueDisplay.textContent = formatDistance(state.target);
    }
    recalc();
  });
  customInput.addEventListener("input", () => {
    state.target = Math.max(0, parseNum(customInput.value, 0));
    recalc();
  });

  // ----- Final pace controls -----
  const finalMin = $("#final-pace-min");
  const finalSec = $("#final-pace-sec");

  finalMin.addEventListener("change", () => {
    state.finalPaceMin = parseNum(finalMin.value, DEFAULT_PACE_MIN);
    recalc();
  });
  finalSec.addEventListener("input", () => {
    state.finalPaceSec = clampInputValue(finalSec, parseNum(finalSec.value), 0, 59);
    recalc();
  });

  // ----- Top-level actions -----
  $("#add-segment").addEventListener("click", () => {
    addSegmentBlock();
    update();
  });
  $("#add-group").addEventListener("click", () => {
    addGroupBlock();
    update();
  });
  $("#reset-btn").addEventListener("click", () => {
    if (!confirm("Reset the whole plan? This clears all segments (saved plans are kept).")) return;
    state = {
      target: 42.195,
      blocks: [],
      finalPaceMin: DEFAULT_PACE_MIN,
      finalPaceSec: DEFAULT_PACE_SEC,
    };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    populateOptions(finalMin, PACE_MIN_MIN, PACE_MIN_MAX, state.finalPaceMin);
    finalSec.value = String(state.finalPaceSec);
    syncTargetInputs();
    update();
  });

  // ----- Cursor-at-end on focus -----
  // When a text value box receives focus, place the caret at the end so
  // backspace clears the field without needing to move the caret first.
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (!el || el.tagName !== "INPUT") return;
    if (el.type !== "text") return;
    setTimeout(() => {
      try {
        const len = (el.value || "").length;
        el.setSelectionRange(len, len);
      } catch (err) {
        /* some browsers still block setSelectionRange on certain inputs */
      }
    }, 0);
  });

  // ----- Saved plans (localStorage) -----
  const PLANS_KEY = "marathon-pacer-plans-v1";

  function loadPlans() {
    try {
      const raw = localStorage.getItem(PLANS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function persistPlans(plans) {
    try {
      localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
    } catch (e) {
      console.warn("Cannot persist plans:", e);
    }
  }

  function snapshotPlan(name) {
    return {
      id: uid(),
      name: name,
      savedAt: Date.now(),
      plan: {
        target: state.target,
        blocks: JSON.parse(JSON.stringify(state.blocks)),
        finalPaceMin: state.finalPaceMin,
        finalPaceSec: state.finalPaceSec,
      },
    };
  }

  function restorePlan(entry) {
    if (!entry || !entry.plan) return;
    state.target = entry.plan.target || 42.195;
    state.blocks = Array.isArray(entry.plan.blocks)
      ? JSON.parse(JSON.stringify(entry.plan.blocks))
      : [];
    state.finalPaceMin =
      entry.plan.finalPaceMin != null ? entry.plan.finalPaceMin : DEFAULT_PACE_MIN;
    state.finalPaceSec =
      entry.plan.finalPaceSec != null ? entry.plan.finalPaceSec : DEFAULT_PACE_SEC;
    state.finalPaceMin = Math.min(
      PACE_MIN_MAX,
      Math.max(PACE_MIN_MIN, state.finalPaceMin)
    );
    populateOptions(finalMin, PACE_MIN_MIN, PACE_MIN_MAX, state.finalPaceMin);
    finalSec.value = String(state.finalPaceSec);
    syncTargetInputs();
    update();
  }

  // Compute distance/time/avg-pace from a stored plan object (not from
  // live state), so the saved-plan list can show a summary without
  // touching the current working plan.
  function flattenPlanSegments(plan) {
    const out = [];
    if (!plan) return out;
    for (const block of plan.blocks || []) {
      if (block.type === "segment" && block.segment) {
        out.push({ seg: block.segment, isFinal: false });
      } else if (block.type === "group") {
        const reps = Math.max(1, Math.floor(parseNum(block.repeats, 1)));
        for (let i = 0; i < reps; i++) {
          for (const s of block.segments || []) {
            out.push({ seg: s, isFinal: false });
          }
        }
      }
    }
    let segKm = 0;
    for (const e of out) segKm += parseNum(e.seg.distance);
    const target = parseNum(plan.target, 0);
    const remaining = Math.max(0, target - segKm);
    if (remaining > 0.0005) {
      out.push({
        seg: {
          distance: remaining,
          paceMin: plan.finalPaceMin || 0,
          paceSec: plan.finalPaceSec || 0,
        },
        isFinal: true,
      });
    }
    return out.filter(
      (e) =>
        parseNum(e.seg.distance) > 0 &&
        paceToSeconds(e.seg.paceMin, e.seg.paceSec) > 0
    );
  }

  function computePlanStats(plan) {
    const data = flattenPlanSegments(plan);
    let distance = 0;
    let seconds = 0;
    for (const e of data) {
      const d = parseNum(e.seg.distance);
      const p = paceToSeconds(e.seg.paceMin, e.seg.paceSec);
      distance += d;
      seconds += d * p;
    }
    const avgPace = distance > 0 ? seconds / distance : 0;
    return { distance, seconds, avgPace, data };
  }

  // Tiny inline stepped area chart for one plan row. Shares the palette
  // with the main chart so the same segment reads the same color. The
  // `blocks` argument is the plan's own blocks (the same ones that
  // produced `data`) and drives the color map.
  function renderPlanSparkline(data, blocks) {
    const W = 96;
    const H = 32;
    const svg = svgEl("svg", {
      viewBox: `0 0 ${W} ${H}`,
      width: String(W),
      height: String(H),
      class: "plan-spark",
      "aria-hidden": "true",
    });
    if (!data || data.length === 0) return svg;

    const totalKm = data.reduce((s, e) => s + parseNum(e.seg.distance), 0);
    if (totalKm <= 0) return svg;
    const paces = data.map((e) => paceToSeconds(e.seg.paceMin, e.seg.paceSec));
    const rawMin = Math.min.apply(null, paces);
    const rawMax = Math.max.apply(null, paces);
    const span = Math.max(10, rawMax - rawMin);
    const yMin = Math.max(0, rawMin - span * 0.2);
    const yMax = rawMax + span * 0.2;

    const padX = 1;
    const padY = 2;
    const innerW = W - padX * 2;
    const innerH = H - padY * 2;
    const xScale = (km) => padX + (km / totalKm) * innerW;
    const yScale = (sec) => padY + ((sec - yMin) / (yMax - yMin)) * innerH;
    const baseY = padY + innerH;

    const finalColor = { line: "#f59e0b", fill: "rgba(245, 158, 11, 0.4)" };
    const colorMap = assignSegmentColors(blocks || []);
    for (const entry of data) {
      if (entry.isFinal) {
        entry._color = finalColor;
        continue;
      }
      const c = colorMap.get(entry.seg && entry.seg.id);
      entry._color = c || SEGMENT_PALETTE[0];
    }

    let cumKm = 0;
    for (const entry of data) {
      const d = parseNum(entry.seg.distance);
      const p = paceToSeconds(entry.seg.paceMin, entry.seg.paceSec);
      const x1 = xScale(cumKm);
      const x2 = xScale(cumKm + d);
      const y = yScale(p);
      svg.appendChild(
        svgEl("path", {
          d: `M ${x1} ${baseY} L ${x1} ${y} L ${x2} ${y} L ${x2} ${baseY} Z`,
          fill: entry._color.fill,
          stroke: "none",
        })
      );
      svg.appendChild(
        svgEl("path", {
          d: `M ${x1} ${y} L ${x2} ${y}`,
          fill: "none",
          stroke: entry._color.line,
          "stroke-width": "1.4",
          "stroke-linecap": "round",
        })
      );
      cumKm += d;
    }
    return svg;
  }

  function renderPlans() {
    const listEl = $("#plans-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    const plans = loadPlans();
    if (plans.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-plans";
      empty.textContent = 'No saved plans yet. Tap "Save current…" to store one.';
      listEl.appendChild(empty);
      return;
    }
    // Most-recent first.
    plans.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    for (const p of plans) {
      const row = document.createElement("div");
      row.className = "plan-row";

      const load = document.createElement("button");
      load.type = "button";
      load.className = "plan-load";
      load.setAttribute("aria-label", `Load plan ${p.name}`);

      const info = document.createElement("div");
      info.className = "plan-info";

      const name = document.createElement("div");
      name.className = "plan-name";
      name.textContent = p.name;

      const meta = document.createElement("div");
      meta.className = "plan-meta";
      const stats = computePlanStats(p.plan || {});
      const metaParts = [];
      if (stats.avgPace > 0) {
        metaParts.push(formatPace(stats.avgPace).replace("/km", ""));
      }
      if (stats.seconds > 0) metaParts.push(formatHMS(stats.seconds));
      if (stats.distance > 0) metaParts.push(formatDistance(stats.distance));
      meta.textContent = metaParts.join(" · ") || "empty plan";

      info.appendChild(name);
      info.appendChild(meta);
      load.appendChild(info);
      load.appendChild(renderPlanSparkline(stats.data, p.plan && p.plan.blocks));

      load.addEventListener("click", () => {
        if (confirm(`Load "${p.name}"? This replaces the current plan.`)) {
          restorePlan(p);
        }
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "row-del plan-del";
      del.setAttribute("aria-label", "Delete saved plan");
      del.innerHTML =
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm(`Delete saved plan "${p.name}"?`)) return;
        persistPlans(loadPlans().filter((x) => x.id !== p.id));
        renderPlans();
      });

      row.appendChild(load);
      row.appendChild(del);
      listEl.appendChild(row);
    }
  }

  $("#save-plan").addEventListener("click", () => {
    const name = prompt("Name this plan:", "");
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const plans = loadPlans();
    plans.push(snapshotPlan(trimmed));
    persistPlans(plans);
    renderPlans();
  });

  // ----- Chart image export -----
  //
  // Clone the live <svg id="pace-chart"> into a larger wrapper SVG that
  // adds a title bar (plan summary stats) and footer branding, then
  // rasterise the whole thing to a PNG via a canvas and hand the user
  // either a `file`-attached share sheet (iOS/Android — gives a real
  // thumbnail preview in iMessage/WhatsApp), a clipboard copy, or a
  // plain download — in that order of preference per platform.
  //
  // The chart SVG uses attribute-level styling (fill=, stroke=, etc.),
  // not a linked stylesheet, so cloning it verbatim is enough — we
  // don't need to inline any CSS to make it render standalone.

  const EXPORT_W = 1200;
  const EXPORT_H = 720;
  const EXPORT_HEADER_H = 170;
  const EXPORT_FOOTER_H = 70;
  const EXPORT_CHART_W = EXPORT_W - 80;
  const EXPORT_CHART_H = EXPORT_H - EXPORT_HEADER_H - EXPORT_FOOTER_H - 20;
  const EXPORT_CHART_X = (EXPORT_W - EXPORT_CHART_W) / 2;
  const EXPORT_CHART_Y = EXPORT_HEADER_H;

  function currentThemeColors() {
    // Match the on-screen chart's dark/light palette so the export
    // looks like a screenshot of what the user sees.
    const dark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return {
      dark,
      bg: dark ? "#0b1220" : "#ffffff",
      card: dark ? "#131a2b" : "#f8fafc",
      text: dark ? "#e5e7eb" : "#0f172a",
      muted: dark ? "#9ca3af" : "#64748b",
      border: dark ? "#243049" : "#e5e7eb",
      accent: "#0b6efd",
    };
  }

  function buildExportSvg() {
    const src = $("#pace-chart");
    if (!src) return null;
    const theme = currentThemeColors();

    // Top-level wrapper SVG. Explicit xmlns is REQUIRED when the SVG
    // is fed to new Image() via a blob URL — without it some browsers
    // (Safari) refuse to load it.
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    svg.setAttribute("width", String(EXPORT_W));
    svg.setAttribute("height", String(EXPORT_H));
    svg.setAttribute("viewBox", `0 0 ${EXPORT_W} ${EXPORT_H}`);

    // Background fill — replaces the document's transparent canvas.
    svg.appendChild(
      svgEl("rect", {
        x: "0",
        y: "0",
        width: String(EXPORT_W),
        height: String(EXPORT_H),
        fill: theme.bg,
      })
    );

    // Header: app badge + plan summary stats.
    const r = computeFinal();
    const avgPace = r.totalDistance > 0 ? r.totalSeconds / r.totalDistance : 0;

    const brand = svgEl("text", {
      x: "40",
      y: "70",
      "font-size": "34",
      "font-weight": "700",
      "font-family":
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      fill: theme.text,
    });
    brand.textContent = "Run Pacer";
    svg.appendChild(brand);

    const tagline = svgEl("text", {
      x: "40",
      y: "100",
      "font-size": "18",
      "font-family":
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      fill: theme.muted,
    });
    tagline.textContent = "Pace plan by segments & repeats";
    svg.appendChild(tagline);

    // Stat tiles, right-aligned.
    const stats = [
      { label: "Distance", value: formatDistance(r.totalDistance) },
      { label: "Total time", value: formatHMS(r.totalSeconds) },
      { label: "Avg pace", value: formatPace(avgPace).replace("/km", "") },
    ];
    const tileW = 230;
    const tileGap = 14;
    const tilesTotalW = tileW * stats.length + tileGap * (stats.length - 1);
    let tileX = EXPORT_W - 40 - tilesTotalW;
    const tileY = 36;
    const tileH = 90;
    for (const s of stats) {
      svg.appendChild(
        svgEl("rect", {
          x: String(tileX),
          y: String(tileY),
          width: String(tileW),
          height: String(tileH),
          rx: "14",
          fill: theme.card,
          stroke: theme.border,
          "stroke-width": "1",
        })
      );
      const lbl = svgEl("text", {
        x: String(tileX + tileW / 2),
        y: String(tileY + 32),
        "text-anchor": "middle",
        "font-size": "15",
        "font-weight": "500",
        "font-family":
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        fill: theme.muted,
      });
      lbl.textContent = s.label;
      svg.appendChild(lbl);
      const val = svgEl("text", {
        x: String(tileX + tileW / 2),
        y: String(tileY + 68),
        "text-anchor": "middle",
        "font-size": "28",
        "font-weight": "700",
        "font-family":
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fill: theme.text,
      });
      val.textContent = s.value;
      svg.appendChild(val);
      tileX += tileW + tileGap;
    }

    // Divider between header and chart.
    svg.appendChild(
      svgEl("line", {
        x1: String(EXPORT_CHART_X),
        y1: String(EXPORT_HEADER_H - 10),
        x2: String(EXPORT_CHART_X + EXPORT_CHART_W),
        y2: String(EXPORT_HEADER_H - 10),
        stroke: theme.border,
        "stroke-width": "1",
      })
    );

    // Nested chart SVG — cloned verbatim, repositioned and resized.
    // Using a nested <svg> preserves the original 600×280 coordinate
    // system, so every path/line the renderChart() routine produced
    // continues to work without having to remap any coordinates.
    const chartClone = src.cloneNode(true);
    chartClone.setAttribute("x", String(EXPORT_CHART_X));
    chartClone.setAttribute("y", String(EXPORT_CHART_Y));
    chartClone.setAttribute("width", String(EXPORT_CHART_W));
    chartClone.setAttribute("height", String(EXPORT_CHART_H));
    chartClone.setAttribute("xmlns", SVG_NS);
    chartClone.removeAttribute("id");
    svg.appendChild(chartClone);

    // Footer.
    svg.appendChild(
      svgEl("line", {
        x1: String(EXPORT_CHART_X),
        y1: String(EXPORT_H - EXPORT_FOOTER_H + 10),
        x2: String(EXPORT_CHART_X + EXPORT_CHART_W),
        y2: String(EXPORT_H - EXPORT_FOOTER_H + 10),
        stroke: theme.border,
        "stroke-width": "1",
      })
    );
    const foot = svgEl("text", {
      x: String(EXPORT_W / 2),
      y: String(EXPORT_H - 26),
      "text-anchor": "middle",
      "font-size": "16",
      "font-family":
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      fill: theme.muted,
    });
    foot.textContent = "Made with Run Pacer";
    svg.appendChild(foot);

    return svg;
  }

  // Rasterise the wrapper SVG to a PNG blob at 2× scale. Using a blob
  // URL (not a data: URL) avoids Safari's length limit on Image src and
  // is faster for big SVGs.
  function svgToPngBlob(svg, scale = 2) {
    return new Promise((resolve, reject) => {
      let serialized;
      try {
        serialized = new XMLSerializer().serializeToString(svg);
      } catch (e) {
        reject(e);
        return;
      }
      // Some serializers drop the xmlns on the root if it was added via
      // setAttribute — defensively re-inject it so the blob parses.
      if (!/\sxmlns=/.test(serialized)) {
        serialized = serialized.replace(
          /^<svg/,
          '<svg xmlns="http://www.w3.org/2000/svg"'
        );
      }
      const svgBlob = new Blob([serialized], {
        type: "image/svg+xml;charset=utf-8",
      });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(EXPORT_W * scale);
          canvas.height = Math.round(EXPORT_H * scale);
          const ctx = canvas.getContext("2d");
          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0, EXPORT_W, EXPORT_H);
          URL.revokeObjectURL(url);
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error("canvas.toBlob returned null"));
              return;
            }
            resolve(blob);
          }, "image/png");
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load SVG into Image"));
      };
      img.src = url;
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser a tick to pick up the click before we free the
    // object URL; some browsers abort the download if the URL is
    // revoked synchronously.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleExportClick() {
    const svg = buildExportSvg();
    if (!svg) {
      alert("No chart to export yet.");
      return;
    }
    let blob;
    try {
      blob = await svgToPngBlob(svg, 2);
    } catch (e) {
      console.error("Chart export failed:", e);
      alert("Could not export chart image.");
      return;
    }

    const r = computeFinal();
    const mins = Math.floor(r.totalSeconds / 60);
    const filename = `run-pacer-${formatDistance(r.totalDistance)
      .replace(/\s+/g, "")
      .replace(/\./g, "_")}-${mins}min.png`;

    // Prefer the native share sheet with the PNG as a file attachment
    // on mobile — this is what actually gives you a proper image
    // preview in iMessage / WhatsApp / etc., since the recipient gets
    // a real image rather than a URL that needs server-side unfurling.
    try {
      if (
        navigator.canShare &&
        typeof File !== "undefined" &&
        navigator.share
      ) {
        const file = new File([blob], filename, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: "Run Pacer chart",
          });
          return;
        }
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
      // Otherwise fall through to a plain download.
    }

    downloadBlob(blob, filename);
    showToast("Chart image downloaded");
  }

  $("#export-chart").addEventListener("click", () => {
    handleExportClick();
  });

  // ----- Share link: encode / decode -----
  //
  // A plan is serialized to a compact tuple form (no IDs, no field
  // names) to keep the payload small, then deflate-compressed (when the
  // browser supports CompressionStream) and base64url-encoded into the
  // URL hash. The IDs are regenerated on import, so the round-trip is
  // lossless for everything the user actually authored: target,
  // blocks, segments, repeats, paces and final pace.
  //
  // Format (versioned so future changes don't break old links):
  //   [1, target, finalPaceMin, finalPaceSec, blocks]
  //   segment block: [0, distance, paceMin, paceSec]
  //   group  block:  [1, repeats, [[dist, min, sec], ...]]

  const SHARE_VERSION = 1;

  function planToCompact(src) {
    return [
      SHARE_VERSION,
      Number(src.target) || 0,
      Number(src.finalPaceMin) || 0,
      Number(src.finalPaceSec) || 0,
      (src.blocks || []).map((b) => {
        if (b.type === "segment") {
          const s = b.segment || {};
          return [
            0,
            Number(s.distance) || 0,
            Number(s.paceMin) || 0,
            Number(s.paceSec) || 0,
          ];
        }
        return [
          1,
          Number(b.repeats) || 1,
          (b.segments || []).map((s) => [
            Number(s.distance) || 0,
            Number(s.paceMin) || 0,
            Number(s.paceSec) || 0,
          ]),
        ];
      }),
    ];
  }

  function compactToPlan(arr) {
    if (!Array.isArray(arr) || arr.length < 5) throw new Error("bad share payload");
    const [version, target, fpMin, fpSec, blocks] = arr;
    if (version !== SHARE_VERSION) throw new Error("unsupported share version");
    return {
      target: parseNum(target, 42.195),
      finalPaceMin: clampNum(parseNum(fpMin, DEFAULT_PACE_MIN), PACE_MIN_MIN, PACE_MIN_MAX),
      finalPaceSec: clampNum(parseNum(fpSec, DEFAULT_PACE_SEC), 0, 59),
      blocks: (Array.isArray(blocks) ? blocks : []).map((b) => {
        if (!Array.isArray(b)) return null;
        if (b[0] === 0) {
          return {
            id: uid(),
            type: "segment",
            segment: {
              id: uid(),
              distance: parseNum(b[1]),
              paceMin: clampNum(parseNum(b[2]), PACE_MIN_MIN, PACE_MIN_MAX),
              paceSec: clampNum(parseNum(b[3]), 0, 59),
            },
          };
        }
        if (b[0] === 1) {
          return {
            id: uid(),
            type: "group",
            repeats: clampNum(parseNum(b[1], REPEATS_MIN), REPEATS_MIN, REPEATS_MAX),
            segments: (Array.isArray(b[2]) ? b[2] : []).map((s) => ({
              id: uid(),
              distance: parseNum(s && s[0]),
              paceMin: clampNum(parseNum(s && s[1]), PACE_MIN_MIN, PACE_MIN_MAX),
              paceSec: clampNum(parseNum(s && s[2]), 0, 59),
            })),
          };
        }
        return null;
      }).filter(Boolean),
    };
  }

  function bytesToBase64Url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlToBytes(str) {
    str = String(str).replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // The 'c' prefix marks a compressed payload, 'u' marks an uncompressed
  // fallback. Keeping them distinct means a browser that can encode but
  // not decode (or vice versa) still produces a readable link.
  async function encodeSharePayload(obj) {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    try {
      if (typeof CompressionStream !== "undefined") {
        const cs = new CompressionStream("deflate-raw");
        const writer = cs.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const buf = await new Response(cs.readable).arrayBuffer();
        return "c" + bytesToBase64Url(new Uint8Array(buf));
      }
    } catch (e) {
      console.warn("CompressionStream failed, falling back:", e);
    }
    return "u" + bytesToBase64Url(bytes);
  }

  async function decodeSharePayload(encoded) {
    if (!encoded || encoded.length < 2) throw new Error("empty payload");
    const tag = encoded.charAt(0);
    const body = encoded.slice(1);
    const bytes = base64UrlToBytes(body);
    let jsonBytes = bytes;
    if (tag === "c") {
      if (typeof DecompressionStream === "undefined") {
        throw new Error("decompression not supported in this browser");
      }
      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const buf = await new Response(ds.readable).arrayBuffer();
      jsonBytes = new Uint8Array(buf);
    } else if (tag !== "u") {
      throw new Error("unknown payload tag");
    }
    const json = new TextDecoder().decode(jsonBytes);
    return JSON.parse(json);
  }

  async function buildShareUrl() {
    const compact = planToCompact(state);
    const encoded = await encodeSharePayload(compact);
    const base =
      location.origin + location.pathname + (location.search || "");
    return base + "#p=" + encoded;
  }

  // Transient toast at the bottom of the screen. Used for share-link
  // feedback and import confirmation. Multiple calls replace the
  // previous message.
  let toastTimer = null;
  function showToast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    // Force reflow so the animation restarts on repeated calls.
    void el.offsetWidth;
    el.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("is-visible");
      setTimeout(() => { el.hidden = true; }, 220);
    }, 2600);
  }

  async function handleShareClick() {
    let url;
    try {
      url = await buildShareUrl();
    } catch (e) {
      console.error("Failed to build share URL:", e);
      alert("Could not build share link.");
      return;
    }

    // Always copy the bare URL to the clipboard. We intentionally do
    // NOT use navigator.share: on iOS / Android its share sheet attaches
    // extra text alongside the URL, and several messaging apps (iMessage,
    // WhatsApp) then strip the #fragment when they auto-link the message,
    // which would quietly drop the entire plan payload.
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        showToast("Share link copied to clipboard");
        return;
      }
    } catch (e) {
      // Clipboard blocked (e.g. insecure context) — fall through to the
      // manual prompt so the user can still copy the URL by hand.
    }
    prompt("Copy this share link:", url);
  }

  $("#share-plan").addEventListener("click", () => {
    handleShareClick();
  });

  // ----- Share link: import on page load -----
  //
  // Preservation rule: before replacing the current in-memory plan with
  // the one from the URL, save it as an auto-snapshot so it isn't lost
  // — UNLESS it's the pristine default landing plan (nothing to save)
  // or it already matches one of the entries in the saved-plans list.

  function stripPlanIds(plan) {
    if (!plan) return null;
    return {
      target: Number(plan.target) || 0,
      finalPaceMin: Number(plan.finalPaceMin) || 0,
      finalPaceSec: Number(plan.finalPaceSec) || 0,
      blocks: (plan.blocks || []).map((b) => {
        if (b && b.type === "segment") {
          const s = b.segment || {};
          return {
            type: "segment",
            segment: {
              distance: Number(s.distance) || 0,
              paceMin: Number(s.paceMin) || 0,
              paceSec: Number(s.paceSec) || 0,
            },
          };
        }
        return {
          type: "group",
          repeats: Number(b && b.repeats) || 1,
          segments: (b && b.segments ? b.segments : []).map((s) => ({
            distance: Number(s.distance) || 0,
            paceMin: Number(s.paceMin) || 0,
            paceSec: Number(s.paceSec) || 0,
          })),
        };
      }),
    };
  }

  function plansEqual(a, b) {
    return JSON.stringify(stripPlanIds(a)) === JSON.stringify(stripPlanIds(b));
  }

  function isDefaultLandingPlan(plan) {
    if (!plan) return true;
    const emptyBlocks = !plan.blocks || plan.blocks.length === 0;
    return (
      Math.abs((Number(plan.target) || 0) - 42.195) < 1e-9 &&
      Number(plan.finalPaceMin) === DEFAULT_PACE_MIN &&
      Number(plan.finalPaceSec) === DEFAULT_PACE_SEC &&
      emptyBlocks
    );
  }

  function currentPlanBody() {
    return {
      target: state.target,
      blocks: state.blocks,
      finalPaceMin: state.finalPaceMin,
      finalPaceSec: state.finalPaceSec,
    };
  }

  function autoSaveCurrentIfNeeded() {
    const current = currentPlanBody();
    if (isDefaultLandingPlan(current)) return null;
    const plans = loadPlans();
    if (plans.some((p) => plansEqual(p.plan || {}, current))) return null;
    const ts = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      ts.getFullYear() +
      "-" + pad(ts.getMonth() + 1) +
      "-" + pad(ts.getDate()) +
      " " + pad(ts.getHours()) +
      ":" + pad(ts.getMinutes());
    const entry = {
      id: uid(),
      name: "Auto-saved " + stamp,
      savedAt: Date.now(),
      plan: JSON.parse(JSON.stringify(current)),
    };
    plans.push(entry);
    persistPlans(plans);
    return entry;
  }

  function addImportedToSavedPlans(imported) {
    const plans = loadPlans();
    if (plans.some((p) => plansEqual(p.plan || {}, imported))) return null;
    const ts = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp =
      ts.getFullYear() +
      "-" + pad(ts.getMonth() + 1) +
      "-" + pad(ts.getDate()) +
      " " + pad(ts.getHours()) +
      ":" + pad(ts.getMinutes());
    const entry = {
      id: uid(),
      name: "Shared " + stamp,
      savedAt: Date.now(),
      plan: {
        target: imported.target,
        blocks: JSON.parse(JSON.stringify(imported.blocks)),
        finalPaceMin: imported.finalPaceMin,
        finalPaceSec: imported.finalPaceSec,
      },
    };
    plans.push(entry);
    persistPlans(plans);
    return entry;
  }

  function replaceStateWithImported(imported) {
    state.target = parseNum(imported.target, 42.195);
    state.blocks = Array.isArray(imported.blocks) ? imported.blocks : [];
    state.finalPaceMin = clampNum(
      parseNum(imported.finalPaceMin, DEFAULT_PACE_MIN),
      PACE_MIN_MIN,
      PACE_MIN_MAX
    );
    state.finalPaceSec = clampNum(
      parseNum(imported.finalPaceSec, DEFAULT_PACE_SEC),
      0,
      59
    );
    save();
    populateOptions(finalMin, PACE_MIN_MIN, PACE_MIN_MAX, state.finalPaceMin);
    finalSec.value = String(state.finalPaceSec);
    syncTargetInputs();
    renderPlans();
    update();
  }

  async function tryImportFromHash() {
    const hash = location.hash || "";
    const m = hash.match(/^#p=(.+)$/);
    if (!m) return false;
    let imported;
    try {
      const raw = await decodeSharePayload(m[1]);
      imported = compactToPlan(raw);
    } catch (e) {
      console.warn("Failed to import shared plan:", e);
      // Clear the bad hash so it doesn't keep retrying on refresh.
      try {
        history.replaceState(null, "", location.pathname + location.search);
      } catch (err) {}
      showToast("Invalid share link");
      return false;
    }

    const autoSaved = autoSaveCurrentIfNeeded();
    replaceStateWithImported(imported);
    addImportedToSavedPlans(imported);
    renderPlans();

    // Remove the hash so a later refresh doesn't re-import the same
    // plan on top of whatever the user has edited since.
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (e) {}

    if (autoSaved) {
      showToast('Imported shared plan (previous plan kept as "' + autoSaved.name + '")');
    } else {
      showToast("Imported shared plan");
    }
    return true;
  }

  // ----- Init -----
  load();
  // Make sure final pace inputs are pre-filled (for old saved state where
  // they may still be null) and snap minutes into the dropdown range.
  if (state.finalPaceMin == null) state.finalPaceMin = DEFAULT_PACE_MIN;
  if (state.finalPaceSec == null) state.finalPaceSec = DEFAULT_PACE_SEC;
  state.finalPaceMin = Math.min(
    PACE_MIN_MAX,
    Math.max(PACE_MIN_MIN, state.finalPaceMin)
  );
  populateOptions(finalMin, PACE_MIN_MIN, PACE_MIN_MAX, state.finalPaceMin);
  finalSec.value = String(state.finalPaceSec);
  syncTargetInputs();
  renderPlans();
  update();

  // If the URL carries a shared plan, pick it up after the initial
  // render so the auto-save hook compares against the in-memory plan
  // that's already visible on screen.
  tryImportFromHash();

  // Also respond when the hash changes in-place — e.g. the user pastes
  // a share link into the address bar of an already-open tab. Browsers
  // don't reload on hash-only changes, so without this the new link
  // would silently do nothing.
  window.addEventListener("hashchange", () => {
    tryImportFromHash();
  });
})();
