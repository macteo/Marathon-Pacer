# Run Pacer

A tiny, mobile-first web app to plan running paces by **segments** and **repeats**, with an automatic final segment that closes the gap to your target distance and a live pace chart.

**Try it live: https://macteo.github.io/Marathon-Pacer/**

No accounts, no servers — everything runs in your browser and your plans are stored locally on your device.

## Features

### Planning
- **Target distance** — preset (5K, 10K, 15K, Half, Marathon) or custom km. The current value is shown inline next to the dropdown.
- **Segments** — add as many as you want. Each segment has a distance (km) and a pace (`min'sec"/km`).
- **Repeat groups** — wrap a sequence of segments and run them N times. Drag a group around to reorder it relative to other blocks.
- **Auto final segment** — the app computes how much distance is left to your target and lets you set a single closing pace. Useful for the leftover `2.195 km` of a marathon, the last `0.0975 km` of a half, etc.
- **Drag & drop** — reorder top-level segments and repeat groups by grabbing the dots handle on the left. Works with mouse on desktop and touch on iOS / Android.
- **Saved plans** — name and store as many plans as you want under "Saved plans". Each row shows the plan's average pace, total time, total distance, and a small inline sparkline preview that uses the same per-segment palette as the main chart. Saved plans live in their own slot in `localStorage` so resetting the working plan doesn't clear them.

### Live calculations
- **Total time, total distance, average pace, target distance** in the summary card.
- **Pace-by-distance chart**: a stepped area chart with one color per source segment (every repetition of the same segment uses the same color), the auto final segment highlighted in orange, a dashed horizontal line at the **average pace**, and a dashed vertical line at the **target distance**.

### Mobile-first UX
- Inline labels with right-aligned numeric values, single-line segment rows even at 320 px wide.
- Numeric pickers (`<select>`) for repeat counts and pace minutes — opens the native iOS/Android wheel picker, no fiddling with the keyboard. Seconds and distance stay as keyboard inputs because they're free-form.
- Tap a value field and the caret jumps to the end so backspace clears it without aiming.
- European decimal separator supported (`4,25` is the same as `4.25`).
- Dark mode follows the system theme.

### Storage
- Working plan is auto-saved on every keystroke under `marathon-pacer-state-v1`.
- Saved plans live under `marathon-pacer-plans-v1`. Both are local to the browser — nothing leaves your device.

## Example

- Repeat group ×10:
  - 2 km @ 4'25"/km
  - 2 km @ 4'45"/km
- Auto final segment: **2.195 km** at 4'20"/km
- Total: **42.195 km** in **3:12:51**, average pace **4'34"/km**

## Run locally

Just open `index.html` in a browser. No build step, no dependencies.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy on GitHub Pages

The repository ships with a `.nojekyll` file, so GitHub Pages serves the files as-is.

1. Push to `main`.
2. In **Settings → Pages**, set the source to **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Wait a minute and visit `https://<user>.github.io/Marathon-Pacer/`.

For this repository, the live URL is **https://macteo.github.io/Marathon-Pacer/**.

## License

MIT — see [LICENSE](LICENSE).
