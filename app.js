(function () {
  "use strict";

  const STORAGE_KEY = "marathon-pacer-state-v1";

  /** @typedef {{id:string, distance:number, paceMin:number, paceSec:number}} Segment */
  /** @typedef {{id:string, type:"segment", segment:Segment}} SegmentBlock */
  /** @typedef {{id:string, type:"group", repeats:number, segments:Segment[]}} GroupBlock */
  /** @typedef {SegmentBlock|GroupBlock} Block */

  /** @type {{target:number, blocks:Block[], finalPaceMin:number|null, finalPaceSec:number|null}} */
  let state = {
    target: 42.195,
    blocks: [],
    finalPaceMin: null,
    finalPaceSec: null,
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

  function makeSegment(distance = 0, paceMin = 0, paceSec = 0) {
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

  function renderSegmentRow(seg, onDelete) {
    const node = segTpl.content.firstElementChild.cloneNode(true);
    const dist = $(".seg-distance", node);
    const mi = $(".seg-min", node);
    const se = $(".seg-sec", node);
    const del = $(".seg-del", node);

    dist.value = seg.distance || "";
    mi.value = seg.paceMin || "";
    se.value = seg.paceSec || "";

    dist.addEventListener("input", () => {
      seg.distance = parseNum(dist.value);
      recalc();
    });
    mi.addEventListener("input", () => {
      seg.paceMin = clampNum(parseNum(mi.value), 0, 59);
      recalc();
    });
    se.addEventListener("input", () => {
      seg.paceSec = clampNum(parseNum(se.value), 0, 59);
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

  // Recompute totals and persist without rebuilding inputs (so the
  // on-screen keyboard keeps focus while the user is typing).
  function recalc() {
    renderFinalAndSummary();
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
    state.finalPaceMin = clampNum(parseNum(finalMin.value), 0, 59);
    recalc();
  });
  finalSec.addEventListener("input", () => {
    state.finalPaceSec = clampNum(parseNum(finalSec.value), 0, 59);
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
  if (state.finalPaceMin != null) finalMin.value = state.finalPaceMin;
  if (state.finalPaceSec != null) finalSec.value = state.finalPaceSec;
  syncTargetInputs();
  update();
})();
