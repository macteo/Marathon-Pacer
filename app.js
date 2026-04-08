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
    const n = Number(v);
    return isNaN(n) ? fallback : n;
  };

  const formatDistance = (km) => {
    if (!isFinite(km) || km <= 0) return "0 m";
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(3)} km`;
  };

  const formatHMS = (seconds) => {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
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

    // Show actual values (including 0) instead of falling back to "" so
    // the user always starts from a real number rather than a blank box.
    dist.value = seg.distance == null ? "" : String(seg.distance);
    mi.value = seg.paceMin == null ? "" : String(seg.paceMin);
    se.value = seg.paceSec == null ? "" : String(seg.paceSec);

    dist.addEventListener("input", () => {
      seg.distance = parseNum(dist.value);
      recalc();
    });
    mi.addEventListener("input", () => {
      seg.paceMin = clampInputValue(mi, parseNum(mi.value), 0, 59);
      recalc();
    });
    se.addEventListener("input", () => {
      seg.paceSec = clampInputValue(se, parseNum(se.value), 0, 59);
      recalc();
    });
    del.addEventListener("click", onDelete);

    return node;
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

    for (const block of state.blocks) {
      if (block.type === "segment") {
        const row = renderSegmentRow(block.segment, () => {
          deleteBlock(block.id);
          update();
        });
        blocksEl.appendChild(row);
      } else {
        const node = groupTpl.content.firstElementChild.cloneNode(true);
        const repeatsInput = $(".group-repeats", node);
        const segWrap = $(".group-segments", node);
        const addBtn = $(".group-add-seg", node);
        const delBtn = $(".group-del", node);

        repeatsInput.value = block.repeats;
        repeatsInput.addEventListener("input", () => {
          block.repeats = Math.max(1, Math.floor(parseNum(repeatsInput.value, 1)));
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
          recalc();
        });

        for (const seg of block.segments) {
          const row = renderSegmentRow(seg, () => {
            block.segments = block.segments.filter((s) => s.id !== seg.id);
            update();
          });
          segWrap.appendChild(row);
        }

        blocksEl.appendChild(node);
      }
    }
  }

  function renderFinalAndSummary() {
    const r = computeFinal();

    $("#remaining-distance").textContent = formatDistance(r.remaining);
    $("#final-distance-label").textContent = formatDistance(r.remaining);

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
      mainLine: "#0b6efd",
      mainFill: "rgba(11, 110, 253, 0.28)",
      finalLine: "#f59e0b",
      finalFill: "rgba(245, 158, 11, 0.32)",
    };
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

      // ---- Build the stepped path for the area + line ----
      // We render the main (non-final) segments and the final segment as
      // separate shapes so the final one can be highlighted.
      const points = []; // {x, y, isFinal}
      let cumKm = 0;
      for (const entry of data) {
        const d = parseNum(entry.seg.distance);
        const p = paceToSeconds(entry.seg.paceMin, entry.seg.paceSec);
        const x1 = xScale(cumKm);
        const x2 = xScale(cumKm + d);
        const y = yScale(p);
        points.push({ x: x1, y, isFinal: entry.isFinal });
        points.push({ x: x2, y, isFinal: entry.isFinal });
        cumKm += d;
      }

      const finalStartIdx = points.findIndex((p) => p.isFinal);
      const mainPoints =
        finalStartIdx === -1 ? points : points.slice(0, finalStartIdx);
      const finalPoints =
        finalStartIdx === -1 ? [] : points.slice(finalStartIdx);

      function buildArea(pts, fill, stroke) {
        if (pts.length === 0) return;
        let aD = `M ${pts[0].x} ${baseY} L ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) aD += ` L ${pts[i].x} ${pts[i].y}`;
        aD += ` L ${pts[pts.length - 1].x} ${baseY} Z`;
        svg.appendChild(
          svgEl("path", {
            d: aD,
            fill: fill,
            stroke: "none",
          })
        );
        let lD = `M ${pts[0].x} ${pts[0].y}`;
        for (let i = 1; i < pts.length; i++) lD += ` L ${pts[i].x} ${pts[i].y}`;
        svg.appendChild(
          svgEl("path", {
            d: lD,
            fill: "none",
            stroke: stroke,
            "stroke-width": "2.5",
            "stroke-linejoin": "round",
            "stroke-linecap": "round",
          })
        );
      }

      buildArea(mainPoints, colors.mainFill, colors.mainLine);
      buildArea(finalPoints, colors.finalFill, colors.finalLine);

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

  function syncTargetInputs() {
    const presetValues = ["5", "10", "15", "21.0975", "42.195"];
    const match = presetValues.find((v) => Math.abs(Number(v) - state.target) < 1e-6);
    if (match) {
      presetSel.value = match;
      customWrap.hidden = true;
    } else {
      presetSel.value = "custom";
      customWrap.hidden = false;
      customInput.value = state.target || "";
    }
  }

  presetSel.addEventListener("change", () => {
    if (presetSel.value === "custom") {
      customWrap.hidden = false;
      // Pre-fill custom box with the current target so the user has a real
      // value to edit instead of an empty field.
      if (!customInput.value) customInput.value = String(state.target);
      customInput.focus();
      state.target = parseNum(customInput.value, state.target);
    } else {
      customWrap.hidden = true;
      state.target = Number(presetSel.value);
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

  finalMin.addEventListener("input", () => {
    state.finalPaceMin = clampInputValue(finalMin, parseNum(finalMin.value), 0, 59);
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
    if (!confirm("Reset the whole plan? This clears all segments and saved data.")) return;
    state = {
      target: 42.195,
      blocks: [],
      finalPaceMin: null,
      finalPaceSec: null,
    };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    finalMin.value = "";
    finalSec.value = "";
    syncTargetInputs();
    update();
  });

  // ----- Init -----
  load();
  // Make sure final pace inputs are pre-filled (for old saved state where
  // they may still be null).
  if (state.finalPaceMin == null) state.finalPaceMin = DEFAULT_PACE_MIN;
  if (state.finalPaceSec == null) state.finalPaceSec = DEFAULT_PACE_SEC;
  finalMin.value = String(state.finalPaceMin);
  finalSec.value = String(state.finalPaceSec);
  syncTargetInputs();
  update();
})();
